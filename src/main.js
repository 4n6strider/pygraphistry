'use strict';

/*

    Simple use of client.js with UI bindings

*/


var $               = require('jquery'),
    _               = require('underscore'),
    debug           = require('debug')('StreamGL:main:sc');

var streamClient    = require('./client.js'),
    ui              = require('./ui.js'),
    interaction     = require('./interaction.js'),
    renderConfig    = require('render-config');

/*
Enable debuging output in the console by running:
    localStorage.debug = 'StreamGL:*';
in the console. Disable debug output by running:
    localStorage.removeItem('debug');
*/

console.warn('%cWarning: having the console open can slow down execution significantly!',
    'font-size: 18pt; font-weight: bold; font-family: \'Helvetica Neue\', Helvetica, sans-serif; background-color: rgb(255, 242, 0);');

var QUERY_PARAMS = Object.freeze(ui.getQueryParams());
var DEBUG_MODE = (QUERY_PARAMS.hasOwnProperty('debug') && QUERY_PARAMS.debug !== 'false' &&
        QUERY_PARAMS.debug !== '0');


//canvas * {?camera, ?socket} -> {renderFrame: () -> (), setCamera: camera -> () }
function init (canvas, opts) {

    debug('Initializing client networking driver');

    opts = opts || {};

    var client = streamClient(canvas, opts);

    interaction.setupDrag($('.sim-container'), client.camera)
        .merge(interaction.setupScroll($('.sim-container'), client.camera))
        .subscribe(function(newCamera) {
            client.setCamera(newCamera);
            client.renderFrame();
        });

    renderConfig.scene.render
        .filter(function (itemName) { return renderConfig.scene.items[itemName].renderTarget === 'texture'; })
        .map(interaction.setupMousemove.bind('', $('.sim-container'), client.hitTest))
        .forEach(function (hits) {
            hits
                .sample(10)
                .filter(_.identity)
                .subscribe(function (idx) {
                    $('.hit-label').text(idx > -1 ? ('Mouse over: ' + idx) : '');

                });
        });


    $('#do-disconnect').click(function(btn) {
        btn.disabled = true;
        client.disconnect();
    });

    client.socket.on('error', function(reason) {
        ui.error('Connection error (reason:', reason, (reason||{}).description, ')');
    });

    client.socket.on('disconnect', function(reason){
        $(canvas).parent().addClass('disconnected');
        ui.error('Disconnected (reason:', reason, ')');
    });

    return client;
}

window.addEventListener('load', function(){
    var meter;

    if(DEBUG_MODE) {
        $('html').addClass('debug');
        meter = new FPSMeter($('body')[0]);
    }

    init($('#simulation')[0], {meter: meter});
});