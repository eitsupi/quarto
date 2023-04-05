/*
 * libraries.ts
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

import { Collection, Group, Item, Library, User, ZoteroApi } from "./api";
import { libraryRead, libraryReadVersions, userWebLibrariesDir } from "./storage";
import { SyncActions } from "./sync";
import { zoteroTrace } from "./trace";

export interface LibraryVersions {
  collections: number;
  items: number;
  deleted: number;
}

export interface LibraryData {
  group?: Group;
  versions: LibraryVersions;
  collections: Collection[];
  items: Item[];
}

export interface LibrarySyncActions {
  group?: Group;
  versions: LibraryVersions;
  collections: SyncActions<Collection>,
  items: SyncActions<Item>
}

export function libraryList(user: User, groups: Group[]) : Library[] {
  return [{ type: "user", id: user.userID } as Library]
            .concat(groups.map(group => ({ type: "group", id: group.id, group })));
}

export async function librarySyncActions(
  user: User, 
  library: Library, 
  groupSync: Group | null, 
  zotero: ZoteroApi
) : Promise<LibrarySyncActions> {

  zoteroTrace(`Syncing library (${library.type}-${library.id})`);

  // actions we will return
  const syncActions: LibrarySyncActions = { 
    versions: { 
      collections: 0, 
      items: 0, 
      deleted: 0 
    }, 
    group: groupSync || undefined,
    collections: { 
      deleted: [], 
      updated: []
    },
    items: {
      deleted: [], 
      updated: []
    }
  };

  // get library version numbers already synced to
  const versions = await libraryReadVersions(user, library);

  // check for deletes
  const deleted = await zotero.deleted(library, versions.deleted);
  if (deleted) {

    // update version
    syncActions.versions.deleted = deleted.version || syncActions.versions.deleted;
    
    // process deleted collections
    for (const deletedCollection of deleted.data.collections) {
      traceAction("Removing", "collection", `key: ${deletedCollection}`);
      syncActions.collections.deleted.push(deletedCollection);
    }
    
    // process deleted items
    for (const deletedItem of deleted.data.items) {
      traceAction("Removing", "item", `key: ${deletedItem}`);
      syncActions.items.deleted.push(deletedItem);
    }
  }

  // check for collections
  const collectionChanges = await zotero.collectionVersions(library, versions.collections);
  if (collectionChanges) {
    // process changes
    const collections = await zotero.collections(library, Object.keys(collectionChanges.data));
    for (const collection of collections) {
      traceAction("Updating", "collection", `${collection.name} - ${collection.key}`)
      syncActions.collections.updated.push(collection);
    }
    // update version
    syncActions.versions.collections = collectionChanges.version || syncActions.versions.collections;
  }

  // check for items
  const itemChanges = await zotero.itemVersions(library, versions.items);
  if (itemChanges) {
    // process changes
    const items = await zotero.items(library, Object.keys(itemChanges.data));
    for (const item of items) {
      if (item.data["deleted"]) {
        traceAction("Removing", "item", `key: ${item.key}`);
        syncActions.items.deleted.push(item.key);
      } else {
        traceAction("Updating", "item", `${item.csljson.title || "Untitled"} - ${item.key}`);
        syncActions.items.updated.push(item);
      }
     
    }
    // update version
    syncActions.versions.items = itemChanges?.version || syncActions.versions.items;
  }

  return syncActions;
}

export function librarySync(user: User, library: Library, syncActions: LibrarySyncActions) : LibraryData {

  // read collections and apply actions
  const dir = userWebLibrariesDir(user);
  const { collections: localCollections, items: localItems } = libraryRead(dir, library);
  const collections = syncObjects(localCollections, syncActions.collections);
  const items = syncObjects(localItems, syncActions.items);
  
  // return objects
  return { 
    group: syncActions.group || library.group,
    versions: syncActions.versions,
    collections,
    items
  };
}

export function hasLibrarySyncActions(sync: LibrarySyncActions) {
  return sync.group ||
         sync.collections.deleted.length > 0 ||
         sync.collections.updated.length > 0 ||
         sync.items.deleted.length > 0 ||
         sync.items.updated.length > 0;
}

function syncObjects<T extends { key: string }>(objects: T[], syncActions: SyncActions<T>) {

  // handle deletes
  objects = objects.filter(obj => !syncActions.deleted.includes(obj.key));

  // handle updates (remove then add)
  const updatedIds = syncActions.updated.map(obj => obj.key);
  objects = objects.filter(obj => !updatedIds.includes(obj.key));
  objects.push(...syncActions.updated);

  // return
  return objects;
}

type ObjectType = "collection" | "item";

function traceAction(action: string, type: ObjectType, summary: string) {
  zoteroTrace(`${action} ${type} (${summary})`);
}



