import Color from 'color';
import {
    ref as $ref,
    atom as $atom,
    pathValue as $value
} from '@graphistry/falcor-json-graph';

export function labels(view) {
    return {
        labelsByType: { edge: {}, point: {} },
        labels: {
            id: 'labels',
            name: 'Labels',
            edge: [], point: [],
            opacity: 1, enabled: true,
            timeZone: '', poiEnabled: true,
            foreground: { color: new Color('#000000') },
            background: { color: new Color('#ffffff').alpha(0.9) },
            settings: [
                $ref(`${view}.labels.options`),
            ],
            controls: [{
                selected: false,
                id: 'toggle-label-settings',
                name: 'Label settings',
            }],
            options: {
                id: 'label-options',
                name: '',
                length: 4, ...[{
                    id: 'text-color',
                    type: 'color',
                    name: 'Text Color',
                    value: $ref(`${view}.labels.foreground.color`)
                }, {
                    id: 'background-color',
                    type: 'color',
                    name: 'Background Color',
                    value: $ref(`${view}.labels.background.color`)
                // }, {
                //     id: 'transparency',
                //     type: 'discrete',
                //     name: 'Transparency',
                //     props: {
                //         min: 0, max: 100,
                //         step: 1, scale: 'percent'
                //     },
                //     value: $ref(`${view}.labels.opacity`)
                }, {
                    id: 'show-labels',
                    type: 'bool',
                    name: 'Show Labels',
                    value: $ref(`${view}.labels.enabled`)
                }, {
                    id: 'show-points-of-interest',
                    type: 'bool',
                    name: 'Show Points of Interest',
                    value: $ref(`${view}.labels.poiEnabled`)
                }]
            }
        }
    };
}
