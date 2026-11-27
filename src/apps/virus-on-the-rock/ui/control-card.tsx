/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author OpenAI
 * @author Ludovic Autin <autin@scripps.edu>
 */

import * as React from 'react';

export function ControlCard(props: React.PropsWithChildren<{ title?: string, className?: string, style?: React.CSSProperties }>) {
    return <section className={`vor-card ${props.className ?? ''}`} style={props.style}>
        {props.title && <h2 className='vor-section-title'>{props.title}</h2>}
        {props.children}
    </section>;
}
