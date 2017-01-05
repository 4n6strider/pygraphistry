import _ from 'underscore';
import Select from 'react-select';
import ComboSelector from './combo-selector';
import { tcell as tableCellClassName } from 'pivot-shared/styles.less';
import DateRangePickerWrapper from './TimeRangeWidget/TimeRangeWidget.js';
import styles from 'pivot-shared/styles.less';


const componentsByInputType = {
    text: TextCell,
    combo: ComboCell,
    multi: MultiCell,
    daterange: DateRange,
    pivotCombo: PivotCombo
};

export default function PivotCell({ paramUI, ...props }) {
    const Component = componentsByInputType[paramUI.inputType];
    if (!Component) {
        throw new Error('Unknown pivot cell type:' + paramUI.inputType);
    }
    return <Component paramUI={paramUI} {...props}/>
}

function TextCell({ id, paramKey, paramValue, paramUI, handlers }) {
     return (
         <td className={tableCellClassName + ' ' + styles.pivotTextParam} key={`pcell-${id}-${paramKey}`}>
            <label>{ paramUI.label }</label>
            <input
                type='th'
                defaultValue={paramValue}
                placeholder={paramUI.placeholder}
                readOnly={false}
                disabled={false}
                onChange={ev => ev.preventDefault() ||
                    handlers.setPivotAttributes({
                        [`pivotParameters.${paramKey}`]: ev.target.value
                    })
                }
            />
        </td>
     );
}

// The combo box compenents only handles string values. We stringify the default value
// and the list of options and parse then back when updating the falcor model.
function PivotCombo({ id, paramKey, paramValue, paramUI, previousPivots, handlers }) {
    let options =
        [
            {
                value: JSON.stringify(previousPivots.map(({ id }) => id)),
                label: previousPivots.length > 1 ? 'All Pivots': 'Step 0'
            }
        ];

    if (previousPivots.length > 1) {
        options = options.concat(
            previousPivots.map((pivot, index) =>
                ({
                    value: JSON.stringify([ pivot.id ]),
                    label: `Step ${index}`
                })
            )
        );
    }

    // Wrap setPivotAttributes to parse back the selected item.
    const originalSPA = handlers.setPivotAttributes;
    const stringifiedSPA = (params, investId) => {
        return originalSPA(
            _.mapObject(params, stringifiedArray => JSON.parse(stringifiedArray)
            ), investId
        );
    };

    return (
        <ComboCell id={id}
                   paramKey={paramKey}
                   paramValue={JSON.stringify(paramValue)}
                   paramUI={{ options, ...paramUI }}
                   handlers={{ setPivotAttributes: stringifiedSPA }}
                   />
    );
}

function ComboCell({ id, paramKey, paramValue, paramUI, handlers }) {
    return (
        <td className={styles.pivotComboParam} key={`pcell-${id}-${paramKey}`}>
            <ComboSelector pivotId={id}
                           fldKey={paramKey}
                           paramUI={paramUI}
                           fldValue={paramValue}
                           options={paramUI.options}
                           key={`pcell-${id}-${paramKey}`}
                           setPivotAttributes={handlers.setPivotAttributes}
            />
        </td>
    );
}

function MultiCell({ id, paramKey, paramValue, paramUI, handlers }) {
    return (
        <td key={`pcell-${id}-${paramKey}`}
            className={tableCellClassName + ' ' + styles.pivotMultiParam}>
            <label>{ paramUI.label }</label>
            <Select id={`selector-${id}-${paramKey}`}
                    name={`selector-${id}-${paramKey}`}
                    clearable={true}
                    labelKey="name"
                    valueKey="id"
                    value={paramValue}
                    options={paramUI.options}
                    multi={true}
                    joinValues={true}
                    onChange={ (selected) =>
                        handlers.setPivotAttributes({
                            [`pivotParameters.${paramKey}`]: _.pluck(selected, 'id')
                        })
                    }/>
            </td>
    )
}

function DateRange({ id, paramKey, paramValue, paramUI, handlers }) {
    return (
        <td className={styles.pivotDateRangeParam} key={`pcell-${id}-${paramKey}`}>
            <DateRangePickerWrapper
                paramUI={paramUI}
                paramValue={paramValue}
                paramKey={paramKey}
                setPivotAttributes={handlers.setPivotAttributes}
            />
        </td>
    );
}
