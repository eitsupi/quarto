/*
 * CommandSubMenu.tsx
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

import React, { PropsWithChildren, useContext } from 'react';

import { SubMenuProps, SubMenu } from '../../widgets/Menu';

import { CommandMenuItem } from './CommandMenuItem';
import { CommandManagerContext } from '../../commands/CommandManager';
import { CommandId } from '../../commands/commands';

export const CommandSubMenu: React.FC<PropsWithChildren<SubMenuProps>> = props => {
  // get command manager for command lookup
  const commandManager = useContext(CommandManagerContext);

  let haveCommands = false;
  const children = React.Children.toArray(props.children);
  for (const child of children) {
    if (
      React.isValidElement(child) &&
      child.type === CommandMenuItem &&
      commandManager.commands[child.props.id as CommandId]
    ) {
      haveCommands = true;
      break;
    }
  }

  if (haveCommands) {
    return <SubMenu {...props} />;
  } else {
    return null;
  }
};