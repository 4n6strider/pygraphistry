/* global ace */

ace.define('ace/mode/graphistry_highlight_rules',
    ['require', 'exports', 'module', 'ace/lib/oop', 'ace/mode/text_highlight_rules'],
    function (acequire, exports/*, module*/) {
        'use strict';

        var oop = acequire('../lib/oop');
        var TextHighlightRules = acequire('./text_highlight_rules').TextHighlightRules;

        var GraphistryHighlightRules = function () {

            var keywords = (
                'between|and|or|not|in|' +
                'isnull|notnull|' +
                'like|ilike|' +
                'limit'
                //'case|when|else|end|type'
            );

            var builtinConstants = (
                'true|false|null'
            );

            var builtinFunctions = (
                'DATE|NOW|' +
                'STRING|SUBSTR|SUBSTRING|FIRST|LEFT|LAST|RIGHT|MID|FIND|' +
                'ISBLANK|ISEMPTY|STARTSWITH|ENDSWITH|CONTAINS|' +
                'CONCAT|SPLIT|LOWER|UPPER|LEN|LENGTH|' +
                'REPLACE|TRIM|LTRIM|RTRIM|' +
                'INT|NUMBER|MAX|MIN|' + //SIGN|TRUNC|FLOOR|CEIL|ROUND|LOG|LN|LOG2|LOG10|EXP|
                'COALESCE'
                //'count|min|max|avg|sum|rank'
            );

            var keywordMapper = this.createKeywordMapper({
                'support.function': builtinFunctions,
                'keyword': keywords,
                'constant.language': builtinConstants
            }, 'identifier', true);

            this.$rules = {
                'start' : [ {
                    token : 'comment',
                    regex : '--.*$'
                },  {
                    token : 'comment',
                    start : '/\\*',
                    end : '\\*/'
                }, {
                    token : 'string',           // " string
                    regex : '".*?"'
                }, {
                    token : 'string',           // ' string
                    regex : '\'.*?\''
                }, {
                    token : 'constant.numeric', // float
                    regex : '[+-]?\\d+(?:(?:\\.\\d*)?(?:[eE][+-]?\\d+)?)?\\b'
                }, {
                    token : keywordMapper,
                    regex : '[a-zA-Z_$][a-zA-Z0-9_$]*\\b'
                }, {
                    token : 'keyword.operator',
                    regex : '\\+|\\-|\\/|\\/\\/|%|<@>|@>|<@|&|\\^|~|<|>|<=|=>|==|!=|<>|='
                }, {
                    token : 'paren.lparen',
                    regex : '[\\(]'
                }, {
                    token : 'paren.rparen',
                    regex : '[\\)]'
                }, {
                    token : 'paren.lbracket',
                    regex : '[\\[]'
                }, {
                    token : 'paren.rbracket',
                    regex : '[\\]]'
                }, {
                    token : 'text',
                    regex : '\\s+'
                } ]
            };
            this.normalizeRules();
        };

        oop.inherits(GraphistryHighlightRules, TextHighlightRules);

        exports.GraphistryHighlightRules = GraphistryHighlightRules;
    });

ace.define('ace/mode/graphistry',
    ['require', 'exports', 'module', 'ace/lib/oop', 'ace/mode/text', 'ace/mode/graphistry_highlight_rules', 'ace/range'],
    function (acequire, exports/*, module*/) {
        'use strict';

        var oop = acequire('../lib/oop');
        var TextMode = acequire('./text').Mode;
        var GraphistryHighlightRules = acequire('./graphistry_highlight_rules').GraphistryHighlightRules;
        //var Range = acequire('../range').Range;

        var Mode = function () {
            this.HighlightRules = GraphistryHighlightRules;
        };
        oop.inherits(Mode, TextMode);

        (function () {
            this.lineCommentStart = '--';
            this.$id = 'ace/mode/graphistry';
        }).call(Mode.prototype);

        exports.Mode = Mode;
    });
