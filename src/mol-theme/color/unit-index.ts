/**
 * Copyright (c) 2018-2019 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 */

import { Color } from '../../mol-util/color';
import { Location } from '../../mol-model/location';
import { StructureElement, Link } from '../../mol-model/structure';
import { ColorTheme, LocationColor } from '../color';
import { ParamDefinition as PD } from '../../mol-util/param-definition'
import { ThemeDataContext } from '../../mol-theme/theme';
import { ScaleLegend } from '../../mol-util/color/scale';
import { getPaletteParams, getPalette } from './util';
import { TableLegend } from '../../mol-util/color/tables';

const DefaultColor = Color(0xCCCCCC)
const Description = 'Gives every unit (single chain or collection of single elements) a unique color based on the position (index) of the unit in the list of units in the structure.'

export const UnitIndexColorThemeParams = {
    ...getPaletteParams({ scaleList: 'RedYellowBlue' }),
}
export type UnitIndexColorThemeParams = typeof UnitIndexColorThemeParams
export function getUnitIndexColorThemeParams(ctx: ThemeDataContext) {
    return UnitIndexColorThemeParams // TODO return copy
}

export function UnitIndexColorTheme(ctx: ThemeDataContext, props: PD.Values<UnitIndexColorThemeParams>): ColorTheme<UnitIndexColorThemeParams> {
    let color: LocationColor
    let legend: ScaleLegend | TableLegend | undefined

    if (ctx.structure) {
        const { units } = ctx.structure
        const palette = getPalette(units.length, props)
        legend = palette.legend
        const unitIdColor = new Map<number, Color>()
        for (let i = 0, il = units.length; i <il; ++i) {
            unitIdColor.set(units[i].id, palette.color(i))
        }

        color = (location: Location): Color => {
            if (StructureElement.isLocation(location)) {
                return unitIdColor.get(location.unit.id)!
            } else if (Link.isLocation(location)) {
                return unitIdColor.get(location.aUnit.id)!
            }
            return DefaultColor
        }
    } else {
        color = () => DefaultColor
    }

    return {
        factory: UnitIndexColorTheme,
        granularity: 'instance',
        color,
        props,
        description: Description,
        legend
    }
}

export const UnitIndexColorThemeProvider: ColorTheme.Provider<UnitIndexColorThemeParams> = {
    label: 'Unit Index',
    factory: UnitIndexColorTheme,
    getParams: getUnitIndexColorThemeParams,
    defaultValues: PD.getDefaultValues(UnitIndexColorThemeParams),
    isApplicable: (ctx: ThemeDataContext) => !!ctx.structure
}