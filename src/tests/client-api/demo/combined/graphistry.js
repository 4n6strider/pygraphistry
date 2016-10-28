/**
 * @class
 * @classdesc This object wraps a HTML IFrame of a Graphistry Visualization in order
 * to provide an API for interacting with the graph.
 * @param {Object} iframe - An IFrame containing the Graphistry Visualization, with
 * which we will interact.
 */
function Graphistry (iframe) {
    this.iframe = iframe;
}

// ===================== Non-Falcor APIs
/**
 * Transmit action through StreamGL
 * @private
 * @param {string} msg - the message to post using postMessage
 * @return {Graphistry} this
 */
Graphistry.prototype.__transmitActionStreamgl = function (msg) {
    msg.mode = 'graphistry-action-streamgl';
    msg.tag = '' + Math.random();
    console.log('parent posting', msg, this.iframe.contentWindow);
    this.iframe.contentWindow.postMessage(msg, '*');
    return this;
};

/**
 * Run Graphistry's layout algorithm for a specified number of milliseconds
 * @param {integer} milliseconds - number of milliseconds to run layout
 * @param {function} cb - callback to call once action has completed
 * @return {Graphistry} this
 */
Graphistry.prototype.startClustering = function (milliseconds, cb) {
    return this.__transmitActionStreamgl({type: 'startClustering', args: {duration: milliseconds || 0}});
};

/**
 * Stop Graphistry's layout algorithm
 * @param {function} cb - callback to call once action has completed
 * @return {Graphistry} this
 */
Graphistry.prototype.stopClustering = function (cb) {
    return this.__transmitActionStreamgl({type: 'stopClustering'});
};

/**
 * Center the vizualization
 * @param {function} cb - callback to call once action has completed
 * @return {Graphistry} this
 */
Graphistry.prototype.autocenter = function (percentile, cb) {
    return this.__transmitActionStreamgl({type: 'autocenter', args: {percentile: percentile || 0}});
};

/**
 * Save current workbook
 * @param {function} cb - callback to call once action has completed
 * @return {Graphistry} this
 */
Graphistry.prototype.saveWorkbook = function (cb) {
    return this.__transmitActionStreamgl({type: 'saveWorkbook'});
};

/**
 * Export a static copy of the current visualization
 * @param {string} name - The name of the static export
 * @param {function} cb - callback to call once action has completed
 * @return {Graphistry} this
 */
Graphistry.prototype.exportStatic = function (name, cb) {
    return this.__transmitActionStreamgl({type: 'exportStatic', args: {name: name}});
};


/**
 * Control whether to show Graphistry UI chrome
 * @param {boolean} hide - true to hide, false to show
 * @param {function} cb - callback to call once action has completed
 * @return {Graphistry} this
 */
Graphistry.prototype.toggleChrome = function (show, cb) {
    return this.__transmitActionStreamgl({type: 'toggleChrome', args: {toggle: show || false}});
};

// ===================== Falcor
/**
 * Transmit regular action through falcor model
 * @private
 * @param {string} msg - the message to post using postMessage
 * @return {Graphistry} this
 */
Graphistry.prototype.__transmitAction = function (msg) {
    msg.mode = 'graphistry-action';
    msg.tag = '' + Math.random();
    this.iframe.contentWindow.postMessage(msg, '*');
    return this;
};

/**
 * Filter the graph using the specified expression
 * @params {string} expr - filter expression
 * @param {function} cb - callback to call once action has completed
 * @return {Graphistry} this
 */
Graphistry.prototype.addFilter = function (expr, cb) {
    return this.__transmitAction({
        type: 'add-expression',
        args: ["degree", "number", "point:degree"]});
};

/**
 * Create an exclusion using the given expression
 * @param {string} expr - exclusion expression
 * @param {function} cb - callback to call once action has completed
 * @return {Graphistry} this
 */
Graphistry.prototype.addExclusion = function (expr, cb) {
    return this.__transmitAction({
        type: 'add-expression',
        args: ["degree", "number", "point:degree"]});
};

/**
 * Set the a visual encoding.
 * @param {string} entityType - The type of entity you would like to encode on
 * @param {string} encodingAttribute - The attribute you would like to encode on
 * @param {string} encodingMode - A string indicating how you would like to encode the values
 * @param {string} dataAttribute - A string indicating which attribute of the data you
 * would like to encode
 * @param {function} cb - callback to call once action has completed
 * @return {Graphistry} this
 */
Graphistry.prototype.updateEncoding = function (entityType, encodingAttribute, encodingMode, dataAttribute, cb) {
    console.warn('update-encoding is not a known encoding falcor action');
    return this.__transmitAction({
        type: 'update-encoding',
        args: [entityType, encodingAttribute, encodingMode, dataAttribute]
    });
};

/**
 * Update a visualization settings
 * @param {string} name - name of the settings to change. We currently support:
 * text-color, background-color, transparency, show-labels, show-points-of-interest,
 * tau, gravity, scalingRatio, edgeInfluence, strongGravity, dissuadeHubs, linLog
 * @param {string} value - value to set the setting to
 * @param {function} cb - callback to call once action has completed
 * @returns {Graphistry} this
*/
Graphistry.prototype.updateSetting = function (name, val, cb) {
    return this.__transmitAction({type: 'set-control-value', args: {id: name, value: val}})
};

/**
 * Update the zoom level of the visualization
 * @param {number} level - The level to increase or decrease the zoom by
 * @param {function} cb - callback to call once action has completed
 * @return {Graphistry} this
 */
Graphistry.prototype.updateZoom = function (level, cb) {
    return this.__transmitAction({
        type: 'update-zoom',
        args: [level]});
};

//========= Labels

/**
 * Subscribe to label updates
 * @param {Object} subscriptions - list of subscriptions that will subscribe to label
 * updates: expects two fields, onChange(id,entityType,x,y) and onExit(id, entityType).
 * onChange is notified of a label appearing or changing position, and onExit of it no longer being of interest.
 * @param {function} cb - callback to call once action has completed
 * @return {Graphistry} this
 */
Graphistry.prototype.subscribeLabels = function (subscriptions, cb) {

    var change = subscriptions.onChange || function (id, entityType, x, y) { };
    var exit = subscriptions.onExit || function (id, entityType) { };

    return this.__transmitActionStreamgl({type: 'subscribeLabels'});
};

/**
 * Unsubscribe to label updates
 * @param {function} cb - callback to all subscriptions are disposed.
 * @return {Graphistry} this
 */
Graphistry.prototype.unsubscribeLabels = function (cb) {
    return this.__transmitActionStreamgl({type: 'unsubscribeLabels'});
};

//========= Loader

/**
 * Load a IFrame containing a Graphistry visualization and return a wrapped IFrame,
 * witch convenience methods for interacting with the graph
 * @param {Object} iframe,
 * @param {function} [cb],
 */
function GraphistryLoader (iframe, cb) {

    cb = cb || function () {}

    try {
        if (!iframe) throw new Error("No iframe provided to Graphistry");

        var responded = false;
        var graphistryInit = function (event){
            if (event.data && event.data.graphistry === 'init' && !responded) {
                responded = true;
                cb(null, new Graphistry(iframe));
                iframe.removeEventListener('message', graphistryInit, false);
            }
        };
        window.addEventListener('message', graphistryInit, false);

        setTimeout(function () {
            if (!responded) {
                console.warn("Graphistry slow to respond, if at all");
            }
        }, 3000);

        //trigger hello if missed initial one
        iframe.contentWindow.postMessage({
                'graphistry': 'init',
                'agent': 'graphistryjs',
                'version': '0.0.0'
            }, '*');

    } catch (e) {
        console.error('Graphistry Load Exception', e);
    }

}
