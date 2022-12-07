/*
 * FormikDialog.tsx
 *
 * Copyright (C) 2022 by Posit Software, PBC
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

import React, { useState } from 'react';

import { Classes, Button, Intent, Dialog } from '@blueprintjs/core';
import { Form, Formik, FormikConfig, FormikValues } from 'formik';

import { PropsWithChildren } from 'react';

import { useTranslation } from 'react-i18next';

import dialogStyles from '../dialog/Dialog.module.scss';


export interface FormikDialogProps<Values extends FormikValues = FormikValues> extends FormikConfig<Values> {
  title?: string;
  isOpen: boolean;
  leftButtons?: JSX.Element;
  onOpening?: () => void;
  onOpened?: () => void;
}

function FormikDialog<Values extends FormikValues = FormikValues>(props: PropsWithChildren<FormikDialogProps<Values>>) {

  const { t } = useTranslation();

  const [validateOnChange, setValidateOnChange] = useState(false);

  return (
    <Formik {...props} validateOnChange={validateOnChange} validateOnBlur={false}>
      {formikProps => {

        const onSubmit = (ev: React.FormEvent) =>{
          ev.preventDefault()
          setValidateOnChange(true);
          return formikProps.handleSubmit();
        }

        return <Dialog
          title={props.title}
          isOpen={props.isOpen}
          onOpening={props.onOpening}
          onOpened={props.onOpened}
          className={dialogStyles.dialog}
          autoFocus={true}
          enforceFocus={true}
          canEscapeKeyClose={true}
          canOutsideClickClose={false}
          isCloseButtonShown={true}
          shouldReturnFocusOnClose={true}
          onClose={() => formikProps.resetForm()}
          transitionDuration={150}
          style={{userSelect: 'none'}}
        >
          <Form onSubmit={onSubmit}>
            <div className={Classes.DIALOG_BODY}>{props.children}</div>
              <div className={[Classes.DIALOG_FOOTER, dialogStyles.dialogFooter].join(' ')}>
              <div className={[Classes.DIALOG_FOOTER_ACTIONS, dialogStyles.dialogFooterActions].join(' ')}>
                <div className={dialogStyles.dialogFooterActionsLeft}>{props.leftButtons}</div>
                <div className={dialogStyles.dialogFooterActionsRight}>
                  <Button type='reset'>{t('dialog_cancel')}</Button>
                  <Button intent={Intent.PRIMARY} type='submit'>{t('dialog_ok')}</Button>
                </div>
              </div>
            </div>
          </Form>
       </Dialog>
      }}
     
    </Formik>
  );


};

export default FormikDialog;