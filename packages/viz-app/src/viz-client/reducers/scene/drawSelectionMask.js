import { SCENE_TOUCH_START } from 'viz-shared/actions/scene';
import { createSubject, SceneGestures } from 'viz-client/reducers/support';
import { atom as $atom, pathValue as $value } from '@graphistry/falcor-json-graph';

export function drawSelectionMask(actions) {

    const drawMaskStarts = SceneGestures
        .startFromActions(actions
            .ofType(SCENE_TOUCH_START)
            .filter(({ event, simulating, selectionMask, selectionType }) => (
                !simulating && selectionType === 'window' && (
                !selectionMask || event.getModifierState('Shift'))
            ))
        );

    const drawnMaskSelections = SceneGestures
        .pan(drawMaskStarts)
        .repeat()
        .mergeMap((drag) => drag
            .stopPropagation(true)
            .dragRectInWorldCoords()
            .multicast(createSubject, (drag) => drag.merge(
                drag.takeLast(1).map((point) => {
                    point.refreshMask = true;
                    return point;
                })
            ))
        );

    return drawnMaskSelections.map(toValuesAndInvalidations);
}

export function toValuesAndInvalidations({ rect, falcor, refreshMask }) {
    return {
        falcor: refreshMask ?
            falcor : falcor.withoutDataSource(),
        values: [
            $value(`selection.mask`, $atom(rect)),
            $value(`selection.type`, rect ? 'window' : null),
            $value(`selection.controls[1].selected`, !!rect)
        ],
        invalidations: !refreshMask ? undefined : [
            `inspector.rows`,
            `selection.histogramsById`
        ]
    };
}
