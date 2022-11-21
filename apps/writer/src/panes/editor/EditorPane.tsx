/*
 * EditorPane.tsx
 *
 * Copyright (C) 2019-20 by RStudio, PBC
 *
 * Unless you have received this program directly from RStudio pursuant
 * to the terms of a commercial license agreement with RStudio, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */

import React from 'react';

import { connect } from 'react-redux';

import { Intent, Spinner } from '@blueprintjs/core';

import { 
  Editor, 
  EditorDialogs, 
  EditorOutline, EventType, 
  kAlertTypeError, 
  NavigationType,
  UpdateEvent, 
  OutlineChangeEvent, 
  StateChangeEvent,
  EditorFormat,
  kQuartoDocType
} from 'editor';

import { t } from '../../i18n';

import { CommandManager, withCommandManager } from '../../commands/CommandManager';
import { WorkbenchState } from '../../store/store';
import {
  setEditorMarkdown,
  setEditorSelection,
  setEditorOutline,
  setEditorTitle,
  setEditorLoading,
} from '../../store/editor';
import { Pane } from '../../widgets/Pane';


import { editorProsemirrorCommands, editorExternalCommands, editorDebugCommands } from './editor-commands';
import { EditorActionsContext } from './EditorActionsContext';
import EditorToolbar from './EditorToolbar';

import EditorDialogsImpl from './dialogs/EditorDialogsImpl';
import EditorOutlineSidebar from './outline/EditorOutlineSidebar';

import { editorContext } from './context/editor-context';
import { editorDialogs } from './dialogs/editor-dialogs';

import styles from './EditorPane.module.scss';


interface EditorPaneProps {
  loading: boolean;
  title: string;
  markdown: string;
  showMarkdown: boolean;
  setLoading: (loading: boolean) => void;
  setTitle: (title: string) => void;
  setMarkdown: (markdown: string) => void;
  setOutline: (outline: EditorOutline) => void;
  setSelection: (selection: unknown) => void;
  commandManager: CommandManager;
}

class EditorPane extends React.Component<EditorPaneProps> {
  // container for the editor
  private parent: HTMLDivElement | null;

  // editor instance
  private editor: Editor | null;

  // events we need to unsubscibe from when we are unmounted
  private editorEvents: VoidFunction[];

  // we track the markdown last sent to / observed within the editor
  // so that we can mask out updates that don't change the content
  // (this is neccessary to prevent update loops)
  private editorMarkdown: string | null;

  // services that we provide to the core editor
  private editorDialogsRef: React.RefObject<EditorDialogsImpl>;

  constructor(props: Readonly<EditorPaneProps>) {
    super(props);
    this.state = { loading: true };
    this.parent = null;
    this.editor = null;
    this.editorEvents = [];
    this.editorMarkdown = null;
    this.editorDialogsRef = React.createRef<EditorDialogsImpl>();
    this.onResize = this.onResize.bind(this);
  }

  public render() {
    return (
      <Pane className={'editor-pane'}>
        <EditorActionsContext.Provider value={this}>
          <EditorToolbar />
          <div id="editor" className={styles.editorParent} ref={el => (this.parent = el)}>
            {this.editorLoading()}
            <EditorOutlineSidebar />
          </div>
          <EditorDialogsImpl ref={this.editorDialogsRef} />
        </EditorActionsContext.Provider>
      </Pane>
    );
  }

  public async componentDidMount() {

    const editor = await this.createEditor();
    if (!editor) {
      return;
    }
    this.editor = editor;
        
    window.addEventListener("resize", this.onResize);

    // show any warnings
    this.showPandocWarnings();

    // subscribe to events
    this.onEditorEvent(UpdateEvent, this.onEditorDocChanged);
    this.onEditorEvent(OutlineChangeEvent, this.onEditorOutlineChanged);
    this.onEditorEvent(StateChangeEvent, this.onEditorStateChanged);

    // add commands
    this.props.commandManager.addCommands([
      ...editorProsemirrorCommands(this.editor!.commands()),
      ...editorExternalCommands(this.editor!),
      ...editorDebugCommands(this.editor!),
    ]);

    // set menus
    this.props.commandManager.setMenus(this.editor!.getMenus());

    // update editor
    await this.updateEditor();

    // sync title
    this.syncEditorTitle();
  }

  private onResize() {
    this.editor!.resize();
  }

  public componentWillUnmount() {
    this.editorEvents.forEach(unregister => unregister());
    window.removeEventListener("resize", this.onResize);
  }

  public componentDidUpdate(prevProps: EditorPaneProps) {
    // ignore if the editor is not yet loaded
    if (!this.editor) {
      return;
    }

    // if showMarkdown changed to true then save markdown
    if (this.props.showMarkdown && !prevProps.showMarkdown) {
      this.saveMarkdown();
    }

    // update editor
    this.updateEditor();
  }

  // implement EditorActions interface by proxing to this.editor --
  // we need to do this rather than just passing the this.editor! as
  // the value b/c we wait until after rendering to actually create
  // the editor (because it needs a live DOM element as it's parent)
  public focus() {
    if (this.editor) {
      this.editor.focus();
    }
  }
  public navigate(id: string) {
    if (this.editor) {
      this.editor.navigate(NavigationType.Id, id);
    }
  }

  private editorLoading() {
    if (this.props.loading) {
      return this.props.loading && (
        <div className={['ProseMirror', styles.editorLoading].join(' ')}>
          <div className='body pm-editing-root-node pm-text-color pm-background-color'>
            <Spinner className={styles.editorLoadingSpinner} intent={Intent.NONE} ></Spinner>
          </div>
        </div>
      )
    } else {
      return <div/>;
    }
  }

  
  private async createEditor() : Promise<Editor | undefined> {
    const context = editorContext(() => this.props.commandManager, this.editorDialogs);
    const format: EditorFormat = {
      pandocMode: 'markdown',
      pandocExtensions: '',
      rmdExtensions: {
        codeChunks: true,
        bookdownPart: true,
        bookdownXRef: true,
        bookdownXRefUI: true
      },
      hugoExtensions: {
        shortcodes: true
      },
      docTypes: [kQuartoDocType]
    }
    try {
      return await Editor.create(this.parent!, context, format, { 
        spellCheck: true,
        outerScrollContainer: true 
      });
    } catch(e) {
      this.errorAlert(e);
      return undefined;
    }
  }



  private async updateEditor() {
    // set content (will no-op if prop change was from ourselves)
    await this.setEditorContent(this.props.markdown);
   
    if (this.props.title !== this.editor!.getTitle()) {
      this.editor!.setTitle(this.props.title);
    }
  }

  private get editorDialogs(): EditorDialogs {
    const dialogsImpl = this.editorDialogsRef.current!;
    return editorDialogs(dialogsImpl);
  }
  private async setEditorContent(markdown: string) {
    if (markdown !== this.editorMarkdown) {
      this.editorMarkdown = markdown;
      try {
        await this.editor!.setMarkdown(markdown, this.panmirrorWriterOptions(), false);
        this.props.setTitle(this.editor!.getTitle() || '');
        this.onEditorOutlineChanged();
        if (this.props.loading) {
          this.props.setLoading(false);
          this.editor!.focus();
        }
      } catch (error) {
        this.errorAlert(error);
      }
    }
  }

  private async onEditorDocChanged() {
    if (this.props.showMarkdown) {
      this.saveMarkdown();
    }

    // set title into reduce
    this.syncEditorTitle();
  }

  private syncEditorTitle() {
     // set title into reduce
     const title = this.editor!.getTitle();
     this.props.setTitle(title || '');
  }

  private onEditorOutlineChanged() {
    // set outline into redux
    const outline = this.editor!.getOutline();
    if (outline) {
      this.props.setOutline(outline);
    }
  }

  private async saveMarkdown() {
    try {
      // generate markdown (save a copy so we can ignore resulting update)
      const markdown = await this.editor!.getMarkdown(this.panmirrorWriterOptions());
      this.editorMarkdown = markdown.code;

      // set markdown into redux
      this.props.setMarkdown(markdown.code);
    } catch (error) {
      this.errorAlert(error);
    }
  }

  private errorAlert(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    this.editorDialogs.alert(message, t('error_alert_title'), kAlertTypeError);
  }

  private onEditorStateChanged() {
    this.props.setSelection(this.editor!.getSelection());
  }

  private onEditorEvent<T>(event: EventType<T>, handler: (detail?: T) => void) {
    this.editorEvents.push(this.editor!.subscribe(event, handler.bind(this)));
  }

  private showPandocWarnings() {
    const pandocFormat = this.editor!.getPandocFormat();
    const warnings = pandocFormat.warnings;
    if (warnings.invalidFormat) {
      // console.log('WARNING: invalid pandoc format ' + warnings.invalidFormat);
    }
    if (warnings.invalidOptions.length) {
      // console.log(`WARNING: ${pandocFormat.baseName} does not support options: ${warnings.invalidOptions.join(', ')}`);
    }
  }

  private panmirrorWriterOptions() {
    return {
      atxHeaders: true
    };
  }
}


const mapStateToProps = (state: WorkbenchState) => {
  return {
    loading: state.editor.loading,
    title: state.editor.title,
    markdown: state.editor.markdown,
    showMarkdown: state.prefs.showMarkdown,
  };
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mapDispatchToProps = (dispatch: any) => {
  return {
    setLoading: (loading: boolean) => dispatch(setEditorLoading(loading)),
    setMarkdown: (markdown: string) => dispatch(setEditorMarkdown(markdown)),
    setTitle: (title: string) => dispatch(setEditorTitle(title)),
    setOutline: (outline: EditorOutline) => dispatch(setEditorOutline(outline)),
    setSelection: (selection: unknown) => dispatch(setEditorSelection(selection)),
  };
};

export default withCommandManager(connect(mapStateToProps, mapDispatchToProps)(EditorPane));