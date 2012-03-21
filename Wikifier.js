/*jslint node: true, browser: true */
"use strict";

(function(){

var WikiStore = require("./TiddlyWiki5/js/WikiStore.js").WikiStore
    , Tiddler = require("./TiddlyWiki5/js/Tiddler.js").Tiddler
    , tiddlerInput = require("./TiddlyWiki5/js/TiddlerInput.js")
    , tiddlerOutput = require("./TiddlyWiki5/js/TiddlerOutput.js")
    , WikiTextParser = require("./TiddlyWiki5/js/WikiTextParser.js").WikiTextParser
    , JavaScriptParser = require("./TiddlyWiki5/js/JavaScriptParser.js").JavaScriptParser
    , utils = require("./TiddlyWiki5/js/Utils.js")
    , url = require('url')
    , http = require('http')
    , Emitter = require('events').EventEmitter
    // require macros once, not per wikifier
    , echo = require("./TiddlyWiki5/js/macros/echo.js").macro
    , image = require("./TiddlyWiki5/js/macros/image.js").macro
    , link = require("./TiddlyWiki5/js/macros/link.js").macro
    , list = require("./TiddlyWiki5/js/macros/list.js").macro
    , slider = require("./TiddlyWiki5/js/macros/slider.js").macro
    , story = require("./TiddlyWiki5/js/macros/story.js").macro
    , tiddler = require("./TiddlyWiki5/js/macros/tiddler.js").macro
    , version = require("./TiddlyWiki5/js/macros/version.js").macro
    , video = require("./TiddlyWiki5/js/macros/video.js").macro
    , view = require("./TiddlyWiki5/js/macros/view.js").macro;

var Wikifier = function() {
    var t;
    // Create the main store
    this.store = new WikiStore({disableHtmlWrapperNodes: true});    
    // Register the parsers
    this.store.registerParser("text/x-tiddlywiki",new WikiTextParser({store: this.store}));
    this.store.registerParser("application/javascript",new JavaScriptParser({store: this.store}));
    // Bit of a hack to set up the macros
    this.store.installMacro(echo);
    this.store.installMacro(image);
    this.store.installMacro(link);
    this.store.installMacro(list);
    this.store.installMacro(slider);
    this.store.installMacro(story);
    this.store.installMacro(tiddler);
    this.store.installMacro(version);
    this.store.installMacro(video);
    this.store.installMacro(view);
};

Wikifier.prototype.render = function(tiddlerTitle, contextURI, authToken) {
    /*
     * 1. get tiddler title via contextURI (+authToken)
     * 2. parse for dependencies
     * 3. bring those tiddlers into the store
     * 4. render as html
     */
    // make JavaScript (and jslint) attitude to scoping as
    // icky as possible
    var emitter = new Emitter()
        , emiterror = function(err) {
            emitter.emit('error', err);
        };

    this.tiddlerTitle = tiddlerTitle;
    this.contextURI = contextURI;
    this.authToken = authToken;
    this.emitter = emitter;
    this.emiterror = emiterror;
    this.dependentTiddlers = {};
    this.dependentTiddlers[tiddlerTitle] = true;

    this.processTiddlers();

    return emitter;
};

Wikifier.prototype.processTiddlers = function() {
    var self = this;
    var tiddlers = Object.keys(this.dependentTiddlers);
    if (tiddlers.length == 0) {
        renderTiddler(self.store, self.tiddlerTitle, self.emitter);
    } else {
        var currentTitle = tiddlers.shift();
        var hasFatDependent = this.dependentTiddlers[currentTitle];
        delete this.dependentTiddlers[currentTitle];
        if (currentTitle === '__ignore__') {
            self.getTiddlers(self.processTiddlers);
        } else if (!(/^http/i).test(currentTitle)) {
            this.getTiddler(currentTitle, function(title, content) {
                addTiddlerContentToStore(self.store, content);
                var subdependencies = self.store
                    .parseTiddler(title).dependencies;
                if (subdependencies.dependentAll) {
                    self.dependentTiddlers['__ignore__'] = false;
                }
                if (subdependencies.tiddlers) {
                    for (var subtitle in subdependencies.tiddlers) {
                        if (hasFatDependent) {
                            self.dependentTiddlers[subtitle]
                                = subdependencies.tiddlers[subtitle];
                        }
                    }
                    self.processTiddlers();
                }
            }, function(err) {
                console.warn('failed to get', currentTitle, err);
                self.processTiddlers();
            });
        } else {
            self.processTiddlers();
        }
    }
};

Wikifier.prototype.getTiddler = function(title, callback, errback) {
    var path = this.contextURI + '/' + encodeURIComponent(title)
        , parsed_uri = url.parse(path)
        , self = this;

    var request = http.get({
        'path': parsed_uri.path,
        'host': parsed_uri.hostname,
        'headers': {
            'accept': 'application/json',
            'cookie': this.authToken,
            'user-agent': 'wikifier thang',
            'x-controlview': 'false' // not needed?
        }
    }, function(response) {
        if (response.statusCode === 200) {
            response.setEncoding('utf8');
            var content = '';
            response.on('data', function(chunk) {
                content += chunk;
            });
            response.on('end', function() {
                callback.apply(self, [title, content]);
            });
        } else {
            console.warn(response.statusCode, self.contextURI, title);
            errback('non 200 ' + response.statusCode + ' on ' + title);
        }
    });

    request.on('error', function(error) {
        console.warn('getTiddler error', error, self.contextURI, title);
        errback(error);
    });

};

Wikifier.prototype.getTiddlers = function(callback) {
    var parsed_uri = url.parse(this.contextURI)
        , client = http.createClient(parsed_uri.port ? parsed_uri.port : 80,
            parsed_uri.hostname)
        , self = this
        , getTiddlersEmit = new Emitter();

    client.on('error', this.emiterror);
    var request = client.request('GET', parsed_uri.pathname, {
        'host': parsed_uri.hostname,
        'accept': 'application/json',
        'cookie': this.authToken,
        'user-agent': 'wikifier thang',
        'x-controlview': 'false' // not needed?
    });
    request.end();

    request.on('error', function(error) {
        console.warn('getTiddlers error', error, self.contextURI,
            self.tiddlerTitle);
        this.emiterror;
    });

    request.on('response', function(response) {
        if (response.statusCode === 200) {
            response.setEncoding('utf8');
            var content = '';
            response.on('data', function(chunk) {
                content += chunk;
            });
            response.on('end', function() {
                try {
                    var tiddlersData = JSON.parse(content);
                } catch (err) {
                    console.warn('json parse error for all tiddlers', err);
                }
                for (var i = 0; i < tiddlersData.length; i++) {
                    if (tiddlersData[i].title !== self.tiddlerTitle) {
                        tiddlersData[i].modified =
                            utils.convertFromYYYYMMDDHHMMSS(
                                tiddlersData[i].modified);
                        tiddlersData[i].created =
                            utils.convertFromYYYYMMDDHHMMSS(
                                tiddlersData[i].created);
                        tiddlersData[i].text = '';
                        self.store.addTiddler(new Tiddler(tiddlersData[i]));
                    }
                }
                callback.apply(self);
            });
        } else {
            console.warn(response.statusCode, contextURI, title);
            this.emiterror('non 200 ' + response.statusCode + ' on ' + title);
        }
    });
};

function renderTiddler(store, title, emitter) {
    var output = store.renderTiddler("text/html", title);
    emitter.emit('output', output);
}

function addTiddlerContentToStore(store, content) {
    try {
        var tiddlerData = JSON.parse(content);
        tiddlerData.modified = utils.convertFromYYYYMMDDHHMMSS(
                tiddlerData.modified);
        tiddlerData.created = utils.convertFromYYYYMMDDHHMMSS(
                tiddlerData.created);
        tiddlerData.type = 'text/x-tiddlywiki';
        store.addTiddler(new Tiddler(tiddlerData));
    } catch (err) {
        console.warn('json parse error with', content);
    }
}

exports.Wikifier = Wikifier;

})();
