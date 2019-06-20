/**
 * Copyright (c) 2018 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 */

import * as React from 'react'
import { ParamDefinition as PD } from '../../../mol-util/param-definition';

export interface NumberParamComponentProps {
    label: string
    param: PD.Numeric
    value: number
    onChange(v: number): void
}

export interface NumberParamComponentState {
    value: number
}

export class NumberParamComponent extends React.Component<NumberParamComponentProps, NumberParamComponentState> {
    state = {
        value: this.props.value
    }

    onChange(valueStr: string) {
        const value = this.props.param.step && Number.isInteger(this.props.param.step) ? parseInt(valueStr) : parseFloat(valueStr)
        this.setState({ value })
        this.props.onChange(value)
    }

    render() {
        return <div>
            <span>{this.props.label} </span>
            <input type='range'
                value={this.state.value}
                min={this.props.param.min}
                max={this.props.param.max}
                step={this.props.param.step}
                onChange={e => this.onChange(e.currentTarget.value)}
            >
            </input>
        </div>;
    }
}