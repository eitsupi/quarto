/*
 * workspace.ts
 *
 * Copyright (C) 2023 by Posit Software, PBC
 * Copyright (c) Microsoft Corporation. All rights reserved.
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */

// based on:
// https://github.com/microsoft/vscode/blob/main/extensions/markdown-language-features/server/src/workspace.ts


import fs from "node:fs"
import fspromises from "node:fs/promises";
import path from "node:path"

import { glob } from "glob";

import { URI } from "vscode-uri";
import { Connection, Emitter, TextDocuments } from "vscode-languageserver";
import { Position, Range, TextDocument } from "vscode-languageserver-textdocument";

import { 
  FileStat, 
  ILogger, 
  LogLevel, 
  ITextDocument, 
  LsConfiguration, 
  IWorkspace
} from "./service";

import { isQuartoDoc } from "./core/doc";
import { ResourceMap } from "./service/util/resource-maps";
import { Limiter } from "core";
import { ConfigurationManager, lsConfiguration } from "./config";


export function languageServiceWorkspace(
  workspaceFolders: URI[],
  documents: TextDocuments<TextDocument>,
  connection: Connection,
  configuration: ConfigurationManager,
  logger: ILogger
) : IWorkspace {

  // create config that looks up some settings dynamically
  const lsConfig = lsConfiguration(configuration);

  // track changes to workspace folders
  connection.workspace.onDidChangeWorkspaceFolders(async () => {
    workspaceFolders = (await connection.workspace.getWorkspaceFolders() ?? []).map(x => URI.parse(x.uri));
  });

  // in-memory document cache
  const documentCache = new ResourceMap<VsCodeDocument>();

  const openMarkdownDocumentFromFs = async (resource: URI): Promise<ITextDocument | undefined> => {
		if (!looksLikeMarkdownPath(lsConfig, resource)) {
			return undefined;
		}

		try {
      const text = await fspromises.readFile(resource.fsPath, { encoding: "utf-8" });
      const doc = new VsCodeDocument(resource.toString(), {
				onDiskDoc: TextDocument.create(resource.toString(), 'markdown', 0, text)
			});
			documentCache.set(resource, doc);
			return doc;

		} catch (e) {
			return undefined;
		}
	}

  const statBypassingCache = (resource: URI): FileStat | undefined => {
		const uri = resource.toString();
		if (documents.get(uri)) {
			return { isDirectory: false };
		}
    try {
      const stat = fs.statSync(resource.fsPath);
      return { isDirectory: stat.isDirectory() };
    } catch {
      return undefined;
    }
	}

  // track changes to documents
  const onDidChangeMarkdownDocument = new Emitter<ITextDocument>();
  const onDidCreateMarkdownDocument =  new Emitter<ITextDocument>();
  const onDidDeleteMarkdownDocument = new Emitter<URI>();

  const doDeleteDocument = (uri: URI) => {
		logger.log(LogLevel.Trace, 'VsCodeClientWorkspace.deleteDocument', { document: uri.toString() });
		documentCache.delete(uri);
		onDidDeleteMarkdownDocument.fire(uri);
	}

  documents.onDidOpen(e => {
    if (!isRelevantMarkdownDocument(e.document)) {
      return;
    }
    logger.log(LogLevel.Trace, 'VsCodeClientWorkspace.TextDocument.onDidOpen', { document: e.document.uri });

    const uri = URI.parse(e.document.uri);
    const doc = documentCache.get(uri);

    if (doc) {
      // File already existed on disk
      doc.setInMemoryDoc(e.document);

      // The content visible to the language service may have changed since the in-memory doc
      // may differ from the one on-disk. To be safe we always fire a change event.
      onDidChangeMarkdownDocument.fire(doc);
    } else {
      // We're creating the file for the first time
      const doc = new VsCodeDocument(e.document.uri, { inMemoryDoc: e.document });
      documentCache.set(uri, doc);
      onDidCreateMarkdownDocument.fire(doc);
    }
  });

  documents.onDidChangeContent(e => {
    if (!isRelevantMarkdownDocument(e.document)) {
      return;
    }

    logger.log(LogLevel.Trace, 'VsCodeClientWorkspace.TextDocument.onDidChanceContent', { document: e.document.uri });

    const uri = URI.parse(e.document.uri);
    const entry = documentCache.get(uri);
    if (entry) {
      entry.setInMemoryDoc(e.document);
      onDidChangeMarkdownDocument.fire(entry);
    }
  });

  documents.onDidClose(async e => {
    if (!isRelevantMarkdownDocument(e.document)) {
      return;
    }

    logger.log(LogLevel.Trace, 'VsCodeClientWorkspace.TextDocument.onDidClose', { document: e.document.uri });

    const uri = URI.parse(e.document.uri);
    const doc = documentCache.get(uri);
    if (!doc) {
      // Document was never opened
      return;
    }

    doc.setInMemoryDoc(undefined);
    if (doc.isDetached()) {
      // The document has been fully closed
      doDeleteDocument(uri);
      return;
    }

    // Check that if file has been deleted on disk.
    // This can happen when directories are renamed / moved. VS Code's file system watcher does not
    // notify us when this happens.
    if (!statBypassingCache(uri)) {
      if (documentCache.get(uri) === doc && !doc.hasInMemoryDoc()) {
        doDeleteDocument(uri);
        return;
      }
    }

    // The document still exists on disk
    // To be safe, tell the service that the document has changed because the
    // in-memory doc contents may be different than the disk doc contents.
    onDidChangeMarkdownDocument.fire(doc);
  });

  const workspace : IWorkspace = {

    get workspaceFolders(): readonly URI[] {
      return workspaceFolders;
    },

    onDidChangeMarkdownDocument: onDidChangeMarkdownDocument.event,
    onDidCreateMarkdownDocument: onDidCreateMarkdownDocument.event,
    onDidDeleteMarkdownDocument: onDidDeleteMarkdownDocument.event,

    async getAllMarkdownDocuments(): Promise<Iterable<ITextDocument>> {
      // Add opened files (such as untitled files)
      const openTextDocumentResults = documents.all()
        .filter(doc => isRelevantMarkdownDocument(doc));

      const allDocs = new ResourceMap<ITextDocument>();
      for (const doc of openTextDocumentResults) {
        allDocs.set(URI.parse(doc.uri), doc);
      }

      // And then add files on disk 
      for (const workspaceFolder of this.workspaceFolders) {
        const mdFileGlob = `**/*.{${lsConfig.markdownFileExtensions.join(',')}}`;
        const ignore = [...lsConfig.excludePaths]; 
        const resources = await glob(mdFileGlob, { ignore, cwd: workspaceFolder.toString() } );

        // (read max 20 at a time)
        const maxConcurrent = 20;
        const limiter = new Limiter<ITextDocument | undefined>(maxConcurrent);
        await Promise.all(resources.map(strResource => {
          return limiter.queue(async () => {
            const resource = URI.parse(strResource);
            if (allDocs.has(resource)) {
              return;
            }
  
            const doc = await this.openMarkdownDocument(resource);
            if (doc) {
              allDocs.set(resource, doc);
            }
            return doc;
          });
        }))
      }

      return allDocs.values();
    },
    
    hasMarkdownDocument(resource: URI): boolean {
      return !!documents.get(resource.toString());
    },

    async openMarkdownDocument(resource: URI): Promise<ITextDocument | undefined> {
      const existing = documentCache.get(resource);
      if (existing) {
        return existing;
      }

      const matchingDocument = documents.get(resource.toString());
      if (matchingDocument) {
        let entry = documentCache.get(resource);
        if (entry) {
          entry.setInMemoryDoc(matchingDocument);
        } else {
          entry = new VsCodeDocument(resource.toString(), { inMemoryDoc: matchingDocument });
          documentCache.set(resource, entry);
        }

        return entry;
      }

      return openMarkdownDocumentFromFs(resource);
	  },
    
    async stat(resource: URI): Promise<FileStat | undefined> {
      logger.log(LogLevel.Trace, 'VsCodeClientWorkspace.stat', { resource: resource.toString() });
      if (documentCache.has(resource)) {
        return { isDirectory: false };
      }
      return statBypassingCache(resource);
    },

    async readDirectory(resource: URI): Promise<Iterable<readonly [string, FileStat]>> {
      logger.log(LogLevel.Trace, 'VsCodeClientWorkspace.readDirectory', { resource: resource.toString() });
      const result = await fspromises.readdir(resource.fsPath, { withFileTypes: true });
      return result.map(value => [value.name, { isDirectory: value.isDirectory( )}]);
    },
  };

  return workspace;

}

function isRelevantMarkdownDocument(doc: TextDocument) {
	return isQuartoDoc(doc) && URI.parse(doc.uri).scheme !== 'vscode-bulkeditpreview';	
}


function looksLikeMarkdownPath(config: LsConfiguration, resolvedHrefPath: URI) {
	return config.markdownFileExtensions.includes(path.extname(resolvedHrefPath.fsPath).toLowerCase().replace('.', ''));
}

class VsCodeDocument implements ITextDocument {

	private inMemoryDoc?: TextDocument;
	private onDiskDoc?: TextDocument;

	readonly uri: string;

	constructor(uri: string, init: { inMemoryDoc: TextDocument });
	constructor(uri: string, init: { onDiskDoc: TextDocument });
	constructor(uri: string, init: { inMemoryDoc?: TextDocument; onDiskDoc?: TextDocument }) {
		this.uri = uri;
		this.inMemoryDoc = init?.inMemoryDoc;
		this.onDiskDoc = init?.onDiskDoc;
	}

	get version(): number {
		return this.inMemoryDoc?.version ?? this.onDiskDoc?.version ?? 0;
	}

	get lineCount(): number {
		return this.inMemoryDoc?.lineCount ?? this.onDiskDoc?.lineCount ?? 0;
	}

	getText(range?: Range): string {
		if (this.inMemoryDoc) {
			return this.inMemoryDoc.getText(range);
		}

		if (this.onDiskDoc) {
			return this.onDiskDoc.getText(range);
		}

		throw new Error('Document has been closed');
	}

	positionAt(offset: number): Position {
		if (this.inMemoryDoc) {
			return this.inMemoryDoc.positionAt(offset);
		}

		if (this.onDiskDoc) {
			return this.onDiskDoc.positionAt(offset);
		}

		throw new Error('Document has been closed');
	}

	hasInMemoryDoc(): boolean {
		return !!this.inMemoryDoc;
	}

	isDetached(): boolean {
		return !this.onDiskDoc && !this.inMemoryDoc;
	}

	setInMemoryDoc(doc: TextDocument | undefined) {
		this.inMemoryDoc = doc;
	}

	setOnDiskDoc(doc: TextDocument | undefined) {
		this.onDiskDoc = doc;
	}
}