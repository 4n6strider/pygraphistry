'use strict';

var debug   = require('debug')('graphistry:StreamGL:graphVizApp:dataInspector');
var $       = window.$;
var Rx      = require('rx');
              require('../rx-jquery-stub');
var _       = require('underscore');
var Backbone = require('backbone');
    Backbone.$ = $;
    require('backbone.paginator');
var Backgrid = require('backgrid');
    require('backgrid-paginator');
    require('backgrid-filter');

var util        = require('./util.js');

var ROWS_PER_PAGE = 8;


function init(appState, socket, workerUrl, marquee, histogramPanelToggle, urlParams) {
    var $nodesInspector = $('#inspector-nodes').find('.inspector');
    var $edgesInspector = $('#inspector-edges').find('.inspector');

    var marqueeTriggers = marquee.selections.merge(marquee.doneDragging);

    //////////////////////////////////////////////////////////////////////////
    // Interactions with other tools.
    //////////////////////////////////////////////////////////////////////////

    var $inspectorOverlay = $('#inspector-overlay');
    // Grey out data inspector when marquee is being dragged.
    appState.brushOn.do(function (state) {
        // TODO: Don't rely on CSS state here.
        if (state === 'dragging' && $('#inspector').css('visibility') === 'visible') {
            $inspectorOverlay.css('visibility', 'visible');
        } else {
            $inspectorOverlay.css('visibility', 'hidden');
        }
    }).subscribe(_.identity, util.makeErrorHandler('Grey / Ungrey Data Inspector'));

    // Change sizes based on whether or not histogram is open.
    // TODO: Separate this into some sort of control/window manager.
    histogramPanelToggle.do(function (histogramsOn) {
        // TODO: Why is this inversed here?
        if (!histogramsOn) {
            $('#inspector').css('width', '85%');
            $inspectorOverlay.css('width', '85%');
        } else {
            $('#inspector').css('width', '100%');
            $inspectorOverlay.css('width', '100%');
        }
    }).subscribe(_.identity, util.makeErrorHandler('change width on inspectorOverlay'));


    //////////////////////////////////////////////////////////////////////////
    // Setup Inspector
    //////////////////////////////////////////////////////////////////////////

    // Grab header.
    Rx.Observable.fromCallback(socket.emit, socket)('inspect_header', null)
    .do(function (reply) {
        if (!reply || !reply.success) {
            console.error('Server error on inspectHeader', (reply||{}).error);
        }
    }).filter(function (reply) { return reply && reply.success; })
    .map(function (data) {
        return {
            nodes: {
                columns: createColumns(data.header.nodes, 'Node'),
                urn: data.urns.nodes
            },
            edges: {
                columns: createColumns(data.header.edges, 'Edge'),
                urn: data.urns.edges
            }
        };
    }).map(function (data) {
        return {
            nodes: initPageableGrid(workerUrl, data.nodes.columns, data.nodes.urn, $nodesInspector, appState.activeSelection, urlParams, 1),
            edges: initPageableGrid(workerUrl, data.edges.columns, data.edges.urn, $edgesInspector, appState.activeSelection, urlParams, 2)
        };
    }).do(function (grids) {

        // Now that we have grids, we need to process updates.
        // TODO: This triggers on simulate, when it shouldn't have to (should it?)
        marqueeTriggers.flatMap(function (sel) {
            return Rx.Observable.fromCallback(socket.emit, socket)('set_selection', sel);
        }).do(function (reply) {
            if (!reply || !reply.success) {
                console.error('Server error on set_selection', (reply||{}).error);
            }
        }).filter(function (reply) { return reply && reply.success; })
        .do(function () {
            updateGrid(grids.nodes);
            updateGrid(grids.edges);
        }).subscribe(_.identity, util.makeErrorHandler('fetch data for inspector'));
    }).subscribe(_.identity, util.makeErrorHandler('fetch inspectHeader'));
}

function createColumns(header, title) {
    debug('Inspect Header', header);

    return [{
        name: '_title', // The key of the model attribute
        label: title, // The name to display in the header
        cell: 'string',
        editable: false,
    }].concat(_.map(_.without(header, '_title'), function (key) {
        return {
            name: key,
            label: key,
            cell: 'string',
            editable: false,
        };
    }));
}

function updateGrid(grid) {
    // grid.resetSelectedModels();
    grid.collection.fetch({reset: true});
}

function initPageableGrid(workerUrl, columns, urn, $inspector, activeSelection, urlParams, dim) {

    //////////////////////////////////////////////////////////////////////////
    // Setup Backbone Views and Models
    //////////////////////////////////////////////////////////////////////////

    var SelectableRow = Backgrid.Row.extend({
        mouseoverColor: 'lightblue',
        activeColor: '#0FA5C5',
        events: {
            click: 'rowClick'
        },

        // Give pointer back to view from model.
        initalize: function () {
            this.model.view = this;
        },

        userRender: function () {
            if (this.model.get('selected')) {
                $(this.el).toggleClass('row-selected', true);
            } else {
                $(this.el).toggleClass('row-selected', false);
            }
        },

        rowClick: function () {
            if (!this.model.get('selected')) {
                activeSelection.onNext([{idx: this.model.attributes._index, dim: dim}]);
            } else {
                activeSelection.onNext([]);
            }
        },
    });

    var InspectData = Backbone.Model.extend({});
    var DataFrame = Backbone.PageableCollection.extend({
        model: InspectData,
        url: workerUrl + urn,
        state: {
            pageSize: ROWS_PER_PAGE
        },

        parseState: function (resp) {
            return {
                totalRecords: resp.count,
                currentPage: resp.page
            };
        },

        parseRecords: function (resp) {
            return resp.values;
        }
    });

    var dataFrame = new DataFrame([], {mode: 'server'});

    var grid = new Backgrid.Grid({
        row: SelectableRow,
        columns: columns,
        collection: dataFrame,
        emptyText: 'Empty selection',
        selectedModels: [],
        selection: []
    });

    // Backgrid does some magic with how it assigns properties,
    // so I'm attaching these functions on the outside.

    // TODO: Do we need this as an option?
    // grid.resetSelectedModels = function () {
    //     _.each(grid.selectedModels, function (model) {
    //         console.log('model: ', model);
    //         model.set('selected', false);
    //         model.view.userRender();
    //     });
    //     grid.selectedModels = [];
    //     grid.selection = [];
    //     activeSelection.onNext([]);
    // };
    grid.getSelectedModels = function () {
        return grid.selectedModels;
    };

    grid.renderRows = function () {
        grid.selectedModels = [];
        _.each(grid.body.rows, function (row) {
            // TODO: Kill this hack.
            if (!row.model) {
                return;
            }
            row.model.set('selected', false);
            _.each(grid.selection, function (sel) {
                if (row.model.attributes._index === sel.idx && dim === sel.dim) {
                    grid.selectedModels.push(row.model);
                    row.model.set('selected', true);
                }
            });
            // Seems to be racy at initialization, so guard for now.
            // TODO: Clean up so this guard isn't necessary.
            if (row.userRender) {
                row.userRender();
            }
        });
    };

    grid.listenTo(grid.collection, 'reset', grid.renderRows);

    // Render the grid and attach the root to your HTML document
    $inspector.empty().append(grid.render().el);

    var paginator = new Backgrid.Extension.Paginator({
        windowSize: 20, // Default is 10
        collection: dataFrame
    });

    dataFrame.fetch({reset: true});

    // Propagate active selection changes to views
    activeSelection.do(function (selection) {
        grid.selectedModels = [];
        grid.selection = selection;

        _.each(grid.body.rows, function (row) {
            // Guard against initialization issues.
            // TODO: Figure out instantiation order.
            if (!row.model) {
                return;
            }
            row.model.set('selected', false);
            _.each(selection, function (sel) {
                if (row.model.attributes._index === sel.idx && dim === sel.dim) {
                    grid.selectedModels.push(row.model);
                    row.model.set('selected', true);
                }
            });
            row.userRender();
        });
    }).subscribe(_.identity, util.makeErrorHandler('Render active selection in data inspector'));



    // TODO: Use templates for this stuff instead of making in jquery.
    var divider = $('<div>').addClass('divide-line');
    var paginatorEl = paginator.render().el;

    $inspector.prepend(divider);
    $inspector.append(paginatorEl);


    // TODO: Ungate this feature when it's tested.
    if (urlParams.debug) {
        var serverSideFilter = new Backgrid.Extension.ServerSideFilter({
            collection: dataFrame,
            name: 'search',
            placeholder: 'Search ' + columns[0].label + 's'
        });
        var attemptSearch = function (e) {
            // Because we clobber the handler for this.
            this.showClearButtonMaybe();
            this.search(e);
        };
        // Copied / modified the filter extension. We're overriding here to
        // allow it to debounce itself.
        // TODO: Decide if we should fork, or otherwise extend cleaner.
        var searchRequests = new Rx.ReplaySubject(1);
        var readyForSearch = new Rx.Subject();

        readyForSearch.flatMapLatest(function (lastSearch) {
            return searchRequests.filter(function (req) {
                return req.data.search !== lastSearch;
            }).take(1);
        }).do(function (req) {
            var collection = req.collection;
            var data = req.data;

            var successCb = function () {
                readyForSearch.onNext(req.data.search);
            };

            if (Backbone.PageableCollection &&
                    collection instanceof Backbone.PageableCollection) {
                collection.getFirstPage({data: data, reset: true, fetch: true, success: successCb});
            } else {
                collection.fetch({data: data, reset: true, success: successCb});
            }
        }).subscribe(_.identity, util.makeErrorHandler('search Request Subject'));
        readyForSearch.onNext(null);

        var search = function (e) {
            if (e) {
                e.preventDefault();
            }

            var data = {};
            var query = this.query();
            if (query) {
                data[this.name] = query;
            }
            searchRequests.onNext({
                data: data,
                collection: this.collection,
            });
        };
        serverSideFilter.events = _.extend(serverSideFilter.events, {
            'keyup input[type=search]': 'attemptSearch',
        });
        serverSideFilter.attemptSearch = attemptSearch;
        serverSideFilter.search = search;
        serverSideFilter.delegateEvents();
        // serverSideFilter.on('keyup input[type=search]', attemptSearch, serverSideFilter);
        var filterEl = serverSideFilter.render().el;
        $inspector.prepend(filterEl);
    }

    var $colHeaders = $inspector.find('.backgrid').find('thead').find('tr').children();
    $colHeaders.each(function () {
        var $colHeader = $(this);
        $colHeader.click(function () {
            $colHeaders.not($colHeader).each(function () {
                $(this).removeClass('ascending').removeClass('descending');
            });
        });
    });

    return grid;
}


module.exports = {
    init: init
};

