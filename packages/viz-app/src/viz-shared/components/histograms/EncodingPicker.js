import React from 'react';
import Select from 'react-select';
import RcSwitch from 'rc-switch';
import { Modal, Button, OverlayTrigger, Tooltip, Popover } from 'react-bootstrap';
import classNames from 'classnames';
import _ from 'underscore';

import globalStyles from 'viz-shared/index.less';
import styles from 'viz-shared/components/histograms/styles.less';


const propTypes = {
    id: React.PropTypes.string.isRequired,
    attribute: React.PropTypes.string.isRequired,
    componentType: React.PropTypes.string.isRequired,
    name: React.PropTypes.string,
    sizeValue: React.PropTypes.Array,
    yAxisValue: React.PropTypes.string,
    showModal: React.PropTypes.bool,
    encodings: React.PropTypes.object,
    onYAxisChange: React.PropTypes.func,
    setEncoding: React.PropTypes.func,
    options: React.PropTypes.object.isRequired
};


function makeOptionLists(options) {

    const WIDTH = 50;
    return {
        point: {
            color: options.point.color.map(({name, variant, colors, label}) => ({
                value: name,
                label:
                    <div style={{whiteSpace: 'nowrap', display: 'inline-block'}}>
                    <span className={styles['encoding-icon-container']} >{
                        colors.map((color, idx, all) => <span style={{
                            backgroundColor: color,
                            width: `${WIDTH / all.length}px`
                        }}/>)
                    }</span><label>{label}</label></div>,
            }))
        },
        edge: {
            color: options.edge.color.map(({name, variant, colors, label}) => ({
                value: name,
                label:
                    <div style={{whiteSpace: 'nowrap', display: 'inline-block'}}>
                    <span className={styles['encoding-icon-container']} >{
                        colors.map((color, idx, all) => <span style={{
                            backgroundColor: color,
                            width: `${WIDTH / all.length}px`
                        }}/>)
                    }</span><label>{label}</label></div>,
            }))
        },
        sizeValue: [],
        yAxisValue: 'none'
    };
}


export function isEncoded(encodings, column, encodingType) {
    return encodings
        && encodings[column.componentType]
        && encodings[column.componentType][encodingType]
        && encodings[column.componentType][encodingType].attribute === column.attribute;
}

export default class EncodingPicker extends React.Component {

    constructor(props) {
        super(props);

        this.handleSelectSizeChange = this.handleSelectSizeChange.bind(this);
        this.handleSelectColorChange = this.handleSelectColorChange.bind(this);
        this.handleSelectIconChange = this.handleSelectIconChange.bind(this);
        this.handleSelectYAxisChange = this.handleSelectYAxisChange.bind(this);
        this.handleReverseColorChange = this.handleReverseColorChange.bind(this);

        this.dispatchColorEncodingChange = this.dispatchColorEncodingChange.bind(this);
        this.dispatchIconEncodingChange = this.dispatchIconEncodingChange.bind(this);

        this.close = this.close.bind(this);
        this.open = this.open.bind(this);

        this.state = {
            showModal: false
        };

        if (props.options) {
            this.options = makeOptionLists(props.options);
        }
    }

    dispatchIconEncodingChange({prop, val}) {
        if (!this.props.setEncoding) return;

        const reset = prop === 'icon' ? !val
            : !isEncoded(this.props.encodings, this.props, 'icon');

        return this.props.setEncoding({
            encodingType: 'icon',
            reset,
            graphType: this.props.componentType,
            attribute: this.props.attribute
        });
    }

    dispatchColorEncodingChange({prop, val}) {

        if (!this.props.setEncoding) return;

        const graphType = this.props.componentType;


        const name = //palette; reuse if prop != color
            prop === 'color' ? val
                : isEncoded(this.props.encodings, this.props, 'color') ?
                    this.props.encodings[graphType].color.name
                : undefined;
        const {variant: variation, colors, label} =
            name ?
                this.props.options[this.props.componentType].color
                    .filter( ({name: optName}) => name === optName )[0]
                : {};
        const nameOpts = { reset: !name, name, variation, colors };


        const reverseColorOpts = {
            reverse:
                prop === 'reverseColor' ? val
                    : isEncoded(this.props.encodings, this.props, 'color') ?
                        this.props.encodings[graphType].color.reverse === true
                    : false
        };



        return this.props.setEncoding({
            encodingType: 'color', graphType, attribute: this.props.attribute,
            ...reverseColorOpts,
            ...nameOpts
        });
    }


    handleSelectColorChange (name) {

        return this.dispatchColorEncodingChange({ prop: 'color', val: name })

    }

    handleReverseColorChange (reverseColor) {

        return this.dispatchColorEncodingChange({ prop: 'reverseColor', val: reverseColor });

    }

    handleSelectIconChange (newEnabled) {

        return this.dispatchIconEncodingChange({ prop: 'icon', val: newEnabled })

    }


    handleSelectYAxisChange (yAxisValue) {
        if (this.props.onYAxisChange) {
            this.props.onYAxisChange(yAxisValue || 'none');
        }
    }


    handleSelectSizeChange (newEnabled) {

        if (!this.props.setEncoding) return;

        // No variation for sizes :/
        const reset = !newEnabled;
        const name = this.props.componentType + 'Size';
        const encodingType = 'size';
        const graphType = this.props.componentType;
        const attribute = this.props.attribute;

        this.props.setEncoding({
            name, encodingType, graphType, attribute, reset
        });
    }

    close() {
        this.setState({showModal: false});
    }

    open() {
        this.setState({showModal: true});
    }


    render() {

        const { props, options } = this;
        const { encodings, componentType } = props;

        if (!options || !encodings || !componentType) {
            return <div></div>;
        }

        return (<div id={props.id} name={props.name || props.id} style={{display: 'inline-block'}}>

            <OverlayTrigger placement='top'
                trigger={['hover']} // <-- do this so react bootstrap doesn't complain about accessibility
                style={{zIndex: 999999999}}
                overlay={ <Tooltip id={`${props.id}_tooltip`}>Pick fields</Tooltip> }>
                <Button href='javascript:void(0)'
                    className={classNames({
                        'fa': true,
                        'fa-cog': true,
                        [styles['encoding-picker-button']]: true
                    })}
                    onClick={this.open} />
            </OverlayTrigger>

            <Modal show={this.state.showModal} onHide={this.close} style={{zIndex: 999999999}}>
                <Modal.Header closeButton>
                    <Modal.Title>Visualize <b>{componentType}:{props.attribute}</b></Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <h5>Show using color</h5>
                    <Select simpleValue
                        disabled={false}
                        value={
                            isEncoded(encodings, props, 'color')
                                ? options[componentType].color
                                    .filter( ({value}) =>
                                            value === encodings[componentType].color.name )[0]
                                : []
                        }
                        placeholder="Pick how to visualize"
                        options={ options[componentType].color }
                        id={`${props.id}_select`}
                        name={`${props.name || props.id}_select`}
                        optionRenderer={({value, label}) => label}
                        onChange={this.handleSelectColorChange}
                        />
                    <h5>Reverse color palette order</h5>
                    <RcSwitch
                        checked={
                            isEncoded(encodings, props, 'color')
                            ? encodings[componentType].color.reverse
                            : false
                        }
                        checkedChildren={'On'}
                        unCheckedChildren={'Off'}
                        onChange={ this.handleReverseColorChange }/>
                    {
                        componentType === 'point'
                            ?   <div>
                                    <h5>Show using size</h5>
                                    <RcSwitch
                                        checked={ isEncoded(encodings, props, 'size') }
                                        checkedChildren={'On'}
                                        unCheckedChildren={'Off'}
                                        onChange={ this.handleSelectSizeChange }/>
                                </div>
                            : null
                    }
                    <h5>Histogram Y-Axis scaling</h5>
                    <Select simpleValue
                        disabled={false}
                        value={props.yAxisValue}
                        resetValue={ options.yAxisValue }
                        placeholder="Pick transform"
                        options={
                            [{value: 'none', label: 'none'},
                             {value: 'log', label: 'log'}]
                        }
                        id={`${props.id}_yaxis`}
                        onChange={this.handleSelectYAxisChange} />
                    <h5>Show using icon</h5>
                    <RcSwitch
                        checked={ isEncoded(encodings, props, 'icon') }
                        checkedChildren={'On'}
                        unCheckedChildren={'Off'}
                        onChange={ this.handleSelectIconChange }/>
                    <p>Pick icons by setting field values that are <a href="http://fontawesome.io/icons/">Font Awesome</a> icon names. Example: <q>laptop</q></p>
                </Modal.Body>
                <Modal.Footer>
                    <Button onClick={this.close}>Close</Button>
                </Modal.Footer>
            </Modal>
        </div>);
    }
}

EncodingPicker.propTypes = propTypes
