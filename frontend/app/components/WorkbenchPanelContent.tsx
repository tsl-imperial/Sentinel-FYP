'use client';

import { ResultsPanel } from '@/components/ResultsPanel';
import { RoadInspector } from '@/components/RoadInspector';
import { WelcomeCard } from '@/components/WelcomeCard';
import type { ResultStatus } from '@/lib/summarize';
import type { ClickedRoadMeta } from '@/components/MapView';

/**
 * WorkbenchPanelContent — discriminated union dispatcher for the DockedPanel.
 *
 * Eng-review Section 1, Issue 1: the DockedPanel has 3 distinct mount sources
 * (extraction state, road inspector, welcome card) with explicit precedence
 * (extraction > inspector > welcome). The state machine lives in
 * `workbench/page.tsx`; this component just dispatches to the right child
 * given the current state union.
 *
 * Pure presentational. The parent passes the relevant subset of callbacks.
 */

export type PanelState =
  | { kind: 'closed' }
  | { kind: 'extraction'; status: ResultStatus; elapsedSeconds: number }
  | { kind: 'inspector'; meta: ClickedRoadMeta; currentYear: number }
  | { kind: 'welcome' };

interface WorkbenchPanelContentProps {
  state: Exclude<PanelState, { kind: 'closed' }>;
  onDismissWelcome: () => void;
}

export function WorkbenchPanelContent({ state, onDismissWelcome }: WorkbenchPanelContentProps) {
  switch (state.kind) {
    case 'extraction':
      return <ResultsPanel status={state.status} elapsedSeconds={state.elapsedSeconds} />;
    case 'inspector':
      return (
        <RoadInspector
          osmId={state.meta.osmId}
          name={state.meta.name}
          fclass={state.meta.fclass}
          color={state.meta.color}
          currentYear={state.currentYear}
        />
      );
    case 'welcome':
      return <WelcomeCard onDismiss={onDismissWelcome} />;
  }
}

/** Title shown in the DockedPanel header for each panel state. */
export function titleFor(state: Exclude<PanelState, { kind: 'closed' }>): string {
  switch (state.kind) {
    case 'extraction':
      return 'Extraction results';
    case 'inspector':
      return state.meta.name;
    case 'welcome':
      return 'Get started';
  }
}

/** Stable id for `aria-labelledby`. */
export function titleIdFor(state: Exclude<PanelState, { kind: 'closed' }>): string {
  return `workbench-panel-${state.kind}`;
}
