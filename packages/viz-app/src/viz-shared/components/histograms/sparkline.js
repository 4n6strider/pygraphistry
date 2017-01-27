import React from 'react';
import classNames from 'classnames';
import { Button, Glyphicon } from 'react-bootstrap';
import styles from 'viz-shared/components/histograms/styles.less';
import EncodingPicker from './EncodingPicker.js';
import { isEncoded } from 'viz-shared/components/histograms/EncodingPicker.js';
import { SizeLegendIndicator, YAxisLegendIndicator, IconLegendIndicator } from './sparklineComponents.js';

export const Sparkline = ({ name, yScale, children, componentType,
                            id, width = `calc(100% - 20px)`, height = 50,
                            loading = false, filtered = false, colors = false,
                            isFilterEnabled = true, setEncoding, encodings,
                            onClose, onYScaleChanged, onEncodingChanged }) => {
    const { options } = encodings || {};
    return (
        <div className={classNames({
                [styles['histogram']]: true,
                [styles['has-filter']]: filtered,
                [styles['has-coloring']]: colors,
                [styles['filter-is-enabled']]: isFilterEnabled
            })}>
            <div className={styles['histogram-title']}>
                <div className={styles['histogram-icons']}>
                    <SizeLegendIndicator sizeValue={isEncoded(encodings, {componentType, attribute: name}, 'size')}
                                         onClick={() => setEncoding && setEncoding({
                                             reset: true,
                                             attribute: name,
                                             encodingType: 'size',
                                             graphType: componentType,
                                             name: componentType + 'Size'
                                         })}/>
                    <YAxisLegendIndicator yAxisValue={yScale}
                                          onClick={() => onYScaleChanged('none')}/>
                    <IconLegendIndicator iconValue={isEncoded(encodings, {componentType, attribute: name}, 'icon')}
                                         onClick={() => setEncoding && setEncoding({
                                             reset: true,
                                             attribute: name,
                                             encodingType: 'icon',
                                             graphType: componentType
                                         })}/>
                    <EncodingPicker sizeValue={[]}
                                    attribute={name}
                                    options={options}
                                    showModal={false}
                                    yAxisValue={yScale}
                                    encodings={encodings}
                                    setEncoding={setEncoding}
                                    componentType={componentType}
                                    onYAxisChange={onYScaleChanged}
                                    id={`histogram-encodings-picker-${name}`}/>
                    <Button bsSize='xsmall'
                            href='javascript:void(0)'
                            onClick={() => onClose({ id })}
                            className={classNames({
                                [styles['histogram-close']]: true,
                                [styles['histogram-loading']]: loading
                            })}>
                        <i className={classNames({
                            'fa': true,
                            'fa-fw': true,
                            'fa-spin': loading,
                            'fa-times': !loading,
                            'fa-spinner': loading,
                        })}/>
                    </Button>
                </div>
                <span>
                    {componentType || '\u00a0'}
                    {componentType ? ':' : ''}
                    &#8203;{name || '\u00a0'}
                </span>
            </div>
            <div className={styles['histogram-picture']} style={{ width, height }}>
                {children}
            </div>
        </div>
    );
}
