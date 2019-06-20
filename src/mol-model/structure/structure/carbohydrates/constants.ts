/**
 * Copyright (c) 2018 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 * @author David Sehnal <david.sehnal@gmail.com>
 */

import { Color, ColorMap } from '../../../../mol-util/color';

// follows community standard from https://www.ncbi.nlm.nih.gov/glycans/snfg.html

export const enum SaccharideShapes {
    FilledSphere, FilledCube, CrossedCube, DividedDiamond, FilledCone, DevidedCone,
    FlatBox, FilledStar, FilledDiamond, FlatDiamond, FlatHexagon, Pentagon
}

export const SaccharideColors = ColorMap({
    Blue: 0x0090bc,
    Green:	0x00a651,
    Yellow: 0xffd400,
    Orange: 0xf47920,
    Pink: 0xf69ea1,
    Purple: 0xa54399,
    LightBlue: 0x8fcce9,
    Brown: 0xa17a4d,
    Red: 0xed1c24,

    Secondary: 0xf1ece1
})

export const enum SaccharideType {
    Hexose, HexNAc, Hexosamine, Hexuronate, Deoxyhexose, DeoxyhexNAc, DiDeoxyhexose,
    Pentose, Deoxynonulosonate, DiDeoxynonulosonate, Unknown, Assigned
}

const SaccharideTypeNameMap = {
    [SaccharideType.Hexose]: 'Hexose',
    [SaccharideType.HexNAc]: 'HexNAc',
    [SaccharideType.Hexosamine]: 'Hexosamine',
    [SaccharideType.Hexuronate]: 'Hexuronate',
    [SaccharideType.Deoxyhexose]: 'Deoxyhexose',
    [SaccharideType.DeoxyhexNAc]: 'DeoxyhexNAc',
    [SaccharideType.DiDeoxyhexose]: 'Di-deoxyhexose',
    [SaccharideType.Pentose]: 'Pentose',
    [SaccharideType.Deoxynonulosonate]: 'Deoxynonulosonate',
    [SaccharideType.DiDeoxynonulosonate]: 'Di-deoxynonulosonate',
    [SaccharideType.Unknown]: 'Unknown',
    [SaccharideType.Assigned]: 'Assigned',
}

export function getSaccharideName(type: SaccharideType) {
    return SaccharideTypeNameMap[type]
}

const SaccharideTypeShapeMap = {
    [SaccharideType.Hexose]: SaccharideShapes.FilledSphere,
    [SaccharideType.HexNAc]: SaccharideShapes.FilledCube,
    [SaccharideType.Hexosamine]: SaccharideShapes.CrossedCube,
    [SaccharideType.Hexuronate]: SaccharideShapes.DividedDiamond,
    [SaccharideType.Deoxyhexose]: SaccharideShapes.FilledCone,
    [SaccharideType.DeoxyhexNAc]: SaccharideShapes.DevidedCone,
    [SaccharideType.DiDeoxyhexose]: SaccharideShapes.FlatBox,
    [SaccharideType.Pentose]: SaccharideShapes.FilledStar,
    [SaccharideType.Deoxynonulosonate]: SaccharideShapes.FilledDiamond,
    [SaccharideType.DiDeoxynonulosonate]: SaccharideShapes.FlatDiamond,
    [SaccharideType.Unknown]: SaccharideShapes.FlatHexagon,
    [SaccharideType.Assigned]: SaccharideShapes.Pentagon,
}

export function getSaccharideShape(type: SaccharideType) {
    return SaccharideTypeShapeMap[type]
}

export type SaccharideComponent = {
    abbr: string
    name: string
    color: Color
    type: SaccharideType
}

export const UnknownSaccharideComponent: SaccharideComponent = {
    abbr: 'Unk',
    name: 'Unknown',
    color: SaccharideColors.Secondary,
    type: SaccharideType.Unknown
}

const Monosaccharides: SaccharideComponent[] = [
    { abbr: 'Glc', name: 'Glucose', color: SaccharideColors.Blue, type: SaccharideType.Hexose },
    { abbr: 'Man', name: 'Mannose', color: SaccharideColors.Green, type: SaccharideType.Hexose },
    { abbr: 'Gal', name: 'Galactose', color: SaccharideColors.Yellow, type: SaccharideType.Hexose },
    { abbr: 'Gul', name: 'Gulose', color: SaccharideColors.Orange, type: SaccharideType.Hexose },
    { abbr: 'Alt', name: 'Altrose', color: SaccharideColors.Pink, type: SaccharideType.Hexose },
    { abbr: 'All', name: 'Allose', color: SaccharideColors.Purple, type: SaccharideType.Hexose },
    { abbr: 'Tal', name: 'Talose', color: SaccharideColors.LightBlue, type: SaccharideType.Hexose },
    { abbr: 'Ido', name: 'Idose', color: SaccharideColors.Brown, type: SaccharideType.Hexose },

    { abbr: 'GlcNAc', name: 'N-Acetyl Glucosamine', color: SaccharideColors.Blue, type: SaccharideType.HexNAc },
    { abbr: 'ManNAc', name: 'N-Acetyl Mannosamine', color: SaccharideColors.Green, type: SaccharideType.HexNAc },
    { abbr: 'GalNAc', name: 'N-Acetyl Galactosamine', color: SaccharideColors.Yellow, type: SaccharideType.HexNAc },
    { abbr: 'GulNAc', name: 'N-Acetyl Gulosamine', color: SaccharideColors.Orange, type: SaccharideType.HexNAc },
    { abbr: 'AltNAc', name: 'N-Acetyl Altrosamine', color: SaccharideColors.Pink, type: SaccharideType.HexNAc },
    { abbr: 'AllNAc', name: 'N-Acetyl Allosamine', color: SaccharideColors.Purple, type: SaccharideType.HexNAc },
    { abbr: 'TalNAc', name: 'N-Acetyl Talosamine', color: SaccharideColors.LightBlue, type: SaccharideType.HexNAc },
    { abbr: 'IdoNAc', name: 'N-Acetyl Idosamine', color: SaccharideColors.Brown, type: SaccharideType.HexNAc },

    { abbr: 'GlcN', name: 'Glucosamine', color: SaccharideColors.Blue, type: SaccharideType.Hexosamine },
    { abbr: 'ManN', name: 'Mannosamine', color: SaccharideColors.Green, type: SaccharideType.Hexosamine },
    { abbr: 'GalN', name: 'Galactosamine', color: SaccharideColors.Yellow, type: SaccharideType.Hexosamine },
    { abbr: 'GulN', name: 'Gulosamine', color: SaccharideColors.Orange, type: SaccharideType.Hexosamine },
    { abbr: 'AltN', name: 'Altrosamine', color: SaccharideColors.Pink, type: SaccharideType.Hexosamine },
    { abbr: 'AllN', name: 'Allosamine', color: SaccharideColors.Purple, type: SaccharideType.Hexosamine },
    { abbr: 'TalN', name: 'Talosamine', color: SaccharideColors.LightBlue, type: SaccharideType.Hexosamine },
    { abbr: 'IdoN', name: 'Idosamine', color: SaccharideColors.Brown, type: SaccharideType.Hexosamine },

    { abbr: 'GlcA', name: 'Glucuronic Acid', color: SaccharideColors.Blue, type: SaccharideType.Hexuronate },
    { abbr: 'ManA', name: 'Mannuronic Acid', color: SaccharideColors.Green, type: SaccharideType.Hexuronate },
    { abbr: 'GalA', name: 'Galacturonic Acid', color: SaccharideColors.Yellow, type: SaccharideType.Hexuronate },
    { abbr: 'GulA', name: 'Guluronic Acid', color: SaccharideColors.Orange, type: SaccharideType.Hexuronate },
    { abbr: 'AltA', name: 'Altruronic Acid', color: SaccharideColors.Pink, type: SaccharideType.Hexuronate },
    { abbr: 'AllA', name: 'Alluronic Acid', color: SaccharideColors.Purple, type: SaccharideType.Hexuronate },
    { abbr: 'TalA', name: 'Taluronic Acid', color: SaccharideColors.LightBlue, type: SaccharideType.Hexuronate },
    { abbr: 'IdoA', name: 'Iduronic Acid', color: SaccharideColors.Brown, type: SaccharideType.Hexuronate },

    { abbr: 'Qui', name: 'Quinovose', color: SaccharideColors.Blue, type: SaccharideType.Deoxyhexose },
    { abbr: 'Rha', name: 'Rhamnose', color: SaccharideColors.Green, type: SaccharideType.Deoxyhexose },
    { abbr: '6dGul', name: '6-Deoxy Gulose', color: SaccharideColors.Orange, type: SaccharideType.Deoxyhexose },
    { abbr: '6dAlt', name: '6-Deoxy Altrose', color: SaccharideColors.Pink, type: SaccharideType.Deoxyhexose },
    { abbr: '6dTal', name: '6-Deoxy Talose', color: SaccharideColors.LightBlue, type: SaccharideType.Deoxyhexose },
    { abbr: 'Fuc', name: 'Fucose', color: SaccharideColors.Red, type: SaccharideType.Deoxyhexose },

    { abbr: 'QuiNAc', name: 'N-Acetyl Quinovosamine', color: SaccharideColors.Blue, type: SaccharideType.DeoxyhexNAc },
    { abbr: 'RhaNAc', name: 'N-Acetyl Rhamnosamine', color: SaccharideColors.Green, type: SaccharideType.DeoxyhexNAc },
    { abbr: '6dAltNAc', name: 'N-Acetyl 6-Deoxy Altrosamine', color: SaccharideColors.Pink, type: SaccharideType.DeoxyhexNAc },
    { abbr: '6dTalNAc', name: 'N-Acetyl 6-Deoxy Talosamine', color: SaccharideColors.LightBlue, type: SaccharideType.DeoxyhexNAc },
    { abbr: 'FucNAc', name: 'N-Acetyl Fucosamine', color: SaccharideColors.Red, type: SaccharideType.DeoxyhexNAc },

    { abbr: 'Oli', name: 'Olivose', color: SaccharideColors.Blue, type: SaccharideType.DiDeoxyhexose },
    { abbr: 'Tyv', name: 'Tyvelose', color: SaccharideColors.Green, type: SaccharideType.DiDeoxyhexose },
    { abbr: 'Abe', name: 'Abequose', color: SaccharideColors.Orange, type: SaccharideType.DiDeoxyhexose },
    { abbr: 'Par', name: 'Paratose', color: SaccharideColors.Pink, type: SaccharideType.DiDeoxyhexose },
    { abbr: 'Dig', name: 'Digitoxose', color: SaccharideColors.Purple, type: SaccharideType.DiDeoxyhexose },
    { abbr: 'Col', name: 'Colitose', color: SaccharideColors.LightBlue, type: SaccharideType.DiDeoxyhexose },

    { abbr: 'Ara', name: 'Arabinose', color: SaccharideColors.Green, type: SaccharideType.Pentose },
    { abbr: 'Lyx', name: 'Lyxose', color: SaccharideColors.Yellow, type: SaccharideType.Pentose },
    { abbr: 'Xyl', name: 'Xylose', color: SaccharideColors.Orange, type: SaccharideType.Pentose },
    { abbr: 'Rib', name: 'Ribose', color: SaccharideColors.Pink, type: SaccharideType.Pentose },

    { abbr: 'Kdn', name: 'Keto-Deoxy Nonulonic Acid', color: SaccharideColors.Green, type: SaccharideType.Deoxynonulosonate },
    { abbr: 'Neu5Ac', name: 'N-Acetyl Neuraminic Acid', color: SaccharideColors.Purple, type: SaccharideType.Deoxynonulosonate },
    { abbr: 'Neu5Gc', name: 'N-Glycolyl Neuraminic Acid', color: SaccharideColors.LightBlue, type: SaccharideType.Deoxynonulosonate },
    { abbr: 'Neu', name: 'Neuraminic Acid', color: SaccharideColors.Brown, type: SaccharideType.Deoxynonulosonate },
    { abbr: 'Sia', name: 'Sialic acid', color: SaccharideColors.Red, type: SaccharideType.Deoxynonulosonate },

    { abbr: 'Pse', name: 'Pseudaminic Acid', color: SaccharideColors.Green, type: SaccharideType.DiDeoxynonulosonate },
    { abbr: 'Leg', name: 'Legionaminic Acid', color: SaccharideColors.Yellow, type: SaccharideType.DiDeoxynonulosonate },
    { abbr: 'Aci', name: 'Acinetaminic Acid', color: SaccharideColors.Pink, type: SaccharideType.DiDeoxynonulosonate },
    { abbr: '4eLeg', name: '4-Epilegionaminic Acid', color: SaccharideColors.LightBlue, type: SaccharideType.DiDeoxynonulosonate },

    { abbr: 'Bac', name: 'Bacillosamine', color: SaccharideColors.Blue, type: SaccharideType.Unknown },
    { abbr: 'LDManHep', name: 'L-Glycero-D-Manno Heptose', color: SaccharideColors.Green, type: SaccharideType.Unknown },
    { abbr: 'Kdo', name: 'Keto-Deoxy Octulonic Acid', color: SaccharideColors.Yellow, type: SaccharideType.Unknown },
    { abbr: 'Dha', name: '3-Deoxy Lyxo-Heptulosaric Acid', color: SaccharideColors.Orange, type: SaccharideType.Unknown },
    { abbr: 'DDManHep', name: 'D-Glycero-D-Manno-Heptose', color: SaccharideColors.Pink, type: SaccharideType.Unknown },
    { abbr: 'MurNAc', name: 'N-Acetyl Muramic Acid', color: SaccharideColors.Purple, type: SaccharideType.Unknown },
    { abbr: 'MurNGc', name: 'N-Glycolyl Muramic Acid', color: SaccharideColors.LightBlue, type: SaccharideType.Unknown },
    { abbr: 'Mur', name: 'Muramic Acid', color: SaccharideColors.Brown, type: SaccharideType.Unknown },

    { abbr: 'Api', name: 'Apicose', color: SaccharideColors.Green, type: SaccharideType.Assigned },
    { abbr: 'Fru', name: 'Fructose', color: SaccharideColors.Green, type: SaccharideType.Assigned },
    { abbr: 'Tag', name: 'Tagatose', color: SaccharideColors.Yellow, type: SaccharideType.Assigned },
    { abbr: 'Sor', name: 'Sorbose', color: SaccharideColors.Orange, type: SaccharideType.Assigned },
    { abbr: 'Psi', name: 'Psicose', color: SaccharideColors.Pink, type: SaccharideType.Assigned },
]

export const SaccharidesSnfgMap = (function () {
    const map = new Map<string, SaccharideComponent>()
    for (let i = 0, il = Monosaccharides.length; i < il; ++i) {
        const saccharide = Monosaccharides[i]
        map.set(saccharide.abbr, saccharide)
    }
    return map
})()

export const MonosaccharidesColorTable: [string, Color][] = [
    ['Glc-family', SaccharideColors.Blue],
    ['Man-family', SaccharideColors.Green],
    ['Gal-family', SaccharideColors.Yellow],
    ['Gul-family', SaccharideColors.Orange],
    ['Alt-family', SaccharideColors.Pink],
    ['All-family', SaccharideColors.Purple],
    ['Tal-family', SaccharideColors.LightBlue],
    ['Ido-family', SaccharideColors.Brown],
    ['Fuc-family', SaccharideColors.Red],
    ['Generic/Unknown/Secondary', SaccharideColors.Secondary],
]

const CommonSaccharideNames: { [k: string]: string[] } = {
    // Hexose
    Glc: [
        'GLC', 'BGC',
        'BOG', // via GlyFinder
        'TRE', // via GlyFinder, di-saccharide but homomer
        'MLR', // via GlyFinder, tri-saccharide but homomer
    ],
    Man: ['MAN', 'BMA'],
    Gal: [
        'GAL', 'GLA',
        'GXL' // via PubChem
    ],
    Gul: ['GUP', 'GL0'],
    Alt: ['ALT'],
    All: ['ALL', 'AFD'],
    Tal: ['TAL'],
    Ido: ['4N2'],
    // HexNAc
    GlcNAc: ['NAG', 'NDG'],
    ManNAc: ['NGA', 'A2G'],
    GulNAc: [],
    AltNAc: [],
    AllNAc: ['NAA'],
    TalNAc: [],
    IdoNAc: ['HSQ'],
    // Hexosamine
    GlcN: [
        'GCS', 'PA1',
        'IDU', 'SGN', 'SUS', // via GlyFinder
    ],
    ManN: ['95Z'],
    GalN: ['X6X', '1GN'],
    GulN: [],
    AltN: [],
    AllN: [],
    TalN: [],
    IdoN: [],
    // Hexuronate
    GlcA: ['GCU', 'BDP'],
    ManA: ['MAV', 'BEM'],
    GalA: ['ADA', 'GTR'],
    GulA: ['LGU'],
    AltA: [],
    AllA: [],
    TalA: ['X0X', 'X1X'],
    IdoA: [
        'IDR',
        'IDS', // via GlyFinder
    ],
    // Deoxyhexose
    Qui: ['G6D'],
    Rha: ['RAM', 'RM4'],
    '6dGul': [],
    '6dAlt': [],
    '6dTal': [],
    Fuc: ['FUC', 'FUL'],
    // DeoxyhexNAc
    QuiNAc: [],
    RhaNAc: [],
    '6dAltNAc': [],
    '6dTalNAc': [],
    FucNAc: [],
    // Di-deoxyhexose
    Oli: ['DDA'],
    Tyv: ['TYV'],
    Abe: ['ABE'],
    Par: ['PZU'],
    Dig: [],
    Col: [],
    // Pentose
    Ara: ['ARA', 'ARB'],
    Lyx: ['LDY'],
    Xyl: ['XYS', 'XYP'],
    Rib: ['RIP', '0MK'],
    // Deoxynonulosonate
    Kdn: ['KDN', 'KDM'],
    Neu5Ac: ['SIA', 'SLB'],
    Neu5Gc: ['NGC', 'NGE'],
    Neu: [],
    Sia: [],
    // Di-deoxynonulosonate
    Pse: ['6PZ'],
    Leg: [],
    Aci: [],
    '4eLeg': [],
    // Unknown
    Bac: ['B6D'],
    LDManHep: ['GMH'],
    Kdo: ['KDO'],
    Dha: [],
    DDManHep: [],
    MurNAc: ['AMU'],
    MurNGc: [],
    Mur: ['MUR'],
    // Assigned
    Api: ['XXM'],
    Fru: ['BDF'],
    Tag: ['T6T'],
    Sor: ['SOE'],
    Psi: [],
}

const UnknownSaccharideNames = [
    'NGZ', // via CCD
    'LAT', // BETA-LACTOSE, Gal-Glc di-saccharide via GlyFinder
]

export const SaccharideCompIdMap = (function () {
    const map = new Map<string, SaccharideComponent>()
    for (let i = 0, il = Monosaccharides.length; i < il; ++i) {
        const saccharide = Monosaccharides[i]
        const names = CommonSaccharideNames[saccharide.abbr]
        if (names) {
            for (let j = 0, jl = names.length; j < jl; ++j) {
                map.set(names[j], saccharide)
            }
        }
    }
    for (let i = 0, il = UnknownSaccharideNames.length; i < il; ++i) {
        map.set(UnknownSaccharideNames[i], UnknownSaccharideComponent)
    }
    return map
})()

export type SaccharideComponentMap = ReadonlyMap<string, SaccharideComponent>
