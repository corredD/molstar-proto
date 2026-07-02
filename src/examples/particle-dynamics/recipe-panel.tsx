/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 *
 * Recipe schematic + table UI for the particle-dynamics example, modeled on Mesoscope's
 * SchematicWidget + IngredientSpreadsheetWidget + RecipeParityPanel (a circle/box schematic and an
 * editable table sharing one selection), but authored against `ParticleRecipe`
 * (`src/examples/particle-dynamics/recipe.ts`) rather than cellPACK JSON. Mounted as a SECOND React
 * root alongside the plugin's own UI (see `index.ts`/`index.html`), wrapped in `PluginReactContext`
 * so any context-consuming control resolves `this.plugin` correctly even outside the plugin's own
 * component tree.
 *
 * Global (shared) simulation parameters - gravity, damping, bounds, compliance, etc. - are NOT
 * duplicated here: `AnimateParticleDynamics.params` already auto-generates a `ParameterControls` view
 * for `ParticleDynamicsParams` in Mol*'s own built-in "Animation" panel, bound live to the running
 * animation. This panel only adds what doesn't already exist: authoring the per-type recipe.
 */

import { PluginUIComponent } from '../../mol-plugin-ui/base';
import { Button } from '../../mol-plugin-ui/controls/common';
import { ParticleRecipe, ParticleRecipeEntry, emptyRecipeEntry } from './recipe';
import { RecipeSchematic } from './recipe-schematic';
import { RecipeTable } from './recipe-table';

export interface RecipePanelDemo {
    getSources(): { id: string, label: string }[]
    getMeshSources(): { id: string, label: string }[]
    applyRecipe(recipe: ParticleRecipe): Promise<void>
}

interface RecipePanelState {
    recipe: ParticleRecipe
    selectedId?: string
    sources: { id: string, label: string }[]
    meshSources: { id: string, label: string }[]
}

let nextEntryId = 0;

/** Per-type recipe schematic + table, mirroring Mesoscope's `RecipeParityPanel` (schematic + table
 * sharing one selection). Global simulation tuning stays in Mol*'s existing built-in Animation panel. */
export class RecipePanel extends PluginUIComponent<{ demo: RecipePanelDemo }, RecipePanelState> {
    state: RecipePanelState = {
        recipe: { entries: [] },
        sources: [],
        meshSources: [],
    };

    private refreshSources = () => {
        this.setState({ sources: this.props.demo.getSources(), meshSources: this.props.demo.getMeshSources() });
    };

    componentDidMount() {
        this.refreshSources();
    }

    private onSelect = (id: string) => this.setState({ selectedId: id });

    private onAddEntry = () => {
        const entry = emptyRecipeEntry(`${nextEntryId++}`);
        this.setState({ recipe: { entries: [...this.state.recipe.entries, entry] }, selectedId: entry.id });
    };

    private onDeleteEntry = (id: string) => {
        this.setState({
            recipe: { entries: this.state.recipe.entries.filter(e => e.id !== id) },
            selectedId: this.state.selectedId === id ? undefined : this.state.selectedId,
        });
    };

    private onPatchEntry = (id: string, patch: Partial<ParticleRecipeEntry>) => {
        this.setState({
            recipe: { entries: this.state.recipe.entries.map(e => e.id === id ? { ...e, ...patch } : e) },
        });
    };

    private onApply = () => this.props.demo.applyRecipe(this.state.recipe);

    render() {
        return <div>
            <div style={{ display: 'flex', gap: 4, padding: '4px 8px' }}>
                <Button onClick={this.onAddEntry}>+ Add type</Button>
                <Button onClick={this.refreshSources}>Refresh sources</Button>
                <Button onClick={this.onApply} commit='on'>Apply recipe</Button>
            </div>
            <RecipeSchematic recipe={this.state.recipe} selectedId={this.state.selectedId} onSelect={this.onSelect} />
            <RecipeTable
                recipe={this.state.recipe}
                sources={this.state.sources}
                meshSources={this.state.meshSources}
                selectedId={this.state.selectedId}
                onSelect={this.onSelect}
                onPatchEntry={this.onPatchEntry}
                onDeleteEntry={this.onDeleteEntry}
            />
        </div>;
    }
}
