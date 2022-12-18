/*
 * index.ts
 *
 * Copyright (C) 2022 by Posit Software, PBC
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

import 'vscode-webview';

import { Editor, EditorFormat, kQuartoDocType } from 'editor';

import { EditorState } from './state';

import { editorContext } from './context';

import 'normalize.css/normalize.css';
import '@blueprintjs/core/lib/css/blueprint.css';
import '@blueprintjs/icons/lib/css/blueprint-icons.css';
import "@blueprintjs/popover2/lib/css/blueprint-popover2.css";
import "@blueprintjs/select/lib/css/blueprint-select.css";
import { kEditorContent } from './content';

// establish editor context
const vscode = acquireVsCodeApi<EditorState>();
const context = editorContext(vscode);

// create editor div
const editorDiv = window.document.createElement("div");
editorDiv.style.position = 'absolute';
editorDiv.style.top = '0';
editorDiv.style.left = '0';
editorDiv.style.right = '0';
editorDiv.style.bottom = '0';
window.document.body.appendChild(editorDiv);

// create editor
const format: EditorFormat = {
  pandocMode: 'markdown',
  pandocExtensions: '',
  rmdExtensions: {
    codeChunks: true,
    bookdownPart: true,
    bookdownXRef: true
  },
  hugoExtensions: {
    shortcodes: true
  },
  docTypes: [kQuartoDocType]
}
Editor.create(editorDiv, context, format).then(async (editor) => {
  await editor.setMarkdown(kEditorContent, {}, false);
});









