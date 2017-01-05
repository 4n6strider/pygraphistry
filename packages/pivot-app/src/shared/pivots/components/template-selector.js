import Select from 'react-select';
import { $ref } from '@graphistry/falcor-json-graph';
import styles from 'pivot-shared/styles.less';

export default function TemplateSelector({ id, pivotTemplate, templates, setPivotAttributes }) {
    return (
        <span className={styles.pivotTypeSelectorContainer}>
            <Select
                id={"templateSelector" + id}
                name={"templateSelector" + id}
                clearable={false}
                backspaceRemoves={false}
                value={{value: pivotTemplate.id, label: pivotTemplate.name}}
                options={
                    templates.map(({name, id}) => {
                        return {value: id, label: name};
                    })
                }
                onChange={ ({value}) => {
                    return setPivotAttributes({
                        'pivotTemplate': $ref(`templatesById['${value}']`)
                    })
                }
                }
            />
        </span>
    );
}
