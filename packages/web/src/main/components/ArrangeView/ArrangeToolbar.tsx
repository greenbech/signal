import React, { StatelessComponent } from "react"
import { observer, inject } from "mobx-react"

import Icon from "components/outputs/Icon"
import {
  Toolbar,
  ToolbarItem,
  ToolbarSeparator
} from "components/groups/Toolbar"
import QuantizeSelector from "components/QuantizeSelector/QuantizeSelector"

import "./ArrangeToolbar.css"

export interface ArrangeToolbarProps {
  autoScroll: boolean
  onClickAutoScroll: (e: any) => void
  quantize: number
  onSelectQuantize: (e: { denominator: number }) => void
}

export const ArrangeToolbar: StatelessComponent<ArrangeToolbarProps> = ({
  autoScroll,
  onClickAutoScroll,
  quantize,
  onSelectQuantize
}) => {
  return (
    <Toolbar className="ArrangeToolbar">
      <QuantizeSelector
        value={quantize}
        onSelect={value => onSelectQuantize({ denominator: value })}
      />

      <ToolbarSeparator />

      <ToolbarItem onClick={onClickAutoScroll} selected={autoScroll}>
        <Icon>pin</Icon>
      </ToolbarItem>
    </Toolbar>
  )
}