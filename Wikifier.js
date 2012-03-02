/*jslint node: true, browser: true */
"use strict";

(function(){

var WikiStore = require("./tiddlywiki5/WikiStore.js").WikiStore
    , Tiddler = require("./tiddlywiki5/Tiddler.js").Tiddler
    , tiddlerInput = require("./tiddlywiki5/TiddlerInput.js")
    , tiddlerOutput = require("./tiddlywiki5/TiddlerOutput.js")
    , WikiTextParser = require("./tiddlywiki5/WikiTextParser.js").WikiTextParser
    , JavaScriptParser = require("./tiddlywiki5/JavaScriptParser.js").JavaScriptParser
    , utils = require("./tiddlywiki5/Utils.js")
    , url = require('url')
    , http = require('http')
    , Emitter = require('events').EventEmitter
    // require macros once, not per wikifier
    , echo = require("./tiddlywiki5/macros/echo.js").macro
    , image = require("./tiddlywiki5/macros/image.js").macro
    , link = require("./tiddlywiki5/macros/link.js").macro
    , list = require("./tiddlywiki5/macros/list.js").macro
    , slider = require("./tiddlywiki5/macros/slider.js").macro
    , story = require("./tiddlywiki5/macros/story.js").macro
    , tiddler = require("./tiddlywiki5/macros/tiddler.js").macro
    , version = require("./tiddlywiki5/macros/version.js").macro
    , view = require("./tiddlywiki5/macros/view.js").macro;

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
        }
        , self = this;

    this.tiddlerTitle = tiddlerTitle;
    this.contextURI = contextURI;
    this.authToken = authToken;
    this.emitter = emitter;
    var dependencyCount = 0;

    this.getTiddler(tiddlerTitle, function(title, content) {
        addTiddlerContentToStore(self.store, content);
        var dependencies = self.store
            .parseTiddler(title).dependencies;
        if (dependencies.dependentAll) {
            self.getTiddlers(dependencies, self.processTiddlers, emiterror);
        } else if (dependencies.tiddlers) {
            self.processTiddlers(dependencies);
        } else {
            renderTiddler(self.store, title, emitter);
        }
    }, emiterror);

    return emitter;
};

Wikifier.prototype.processTiddlers = function(dependencies) {
    var count = 1
        , self = this;
    var tiddlers = [];
    if (dependencies.tiddlers) {
        tiddlers = tiddlers.concat(Object.keys(dependencies.tiddlers));
    }
    var tiddlerCount = tiddlers.length;
    if (tiddlerCount == 0) {
        renderTiddler(self.store, self.tiddlerTitle, self.emitter);
    } else {
        for (var i = 0; i < tiddlers.length; i++) {
            if (!(/^http/i).test(tiddlers[i])) {
                var currentTiddler = tiddlers[i]
                this.getTiddler(currentTiddler, function(title, content) {
                    addTiddlerContentToStore(self.store, content);
                    if (dependencies.tiddlers[title]) {
                        tiddlerCount++;
                        var subdependencies = self.store
                            .parseTiddler(title).dependencies;
                        if (subdependencies.dependentAll) {
                            self.getTiddlers(subdependencies,
                                self.processTiddlers, emiterror);
                        } else if (subdependencies.tiddlers) {
                            self.processTiddlers(subdependencies);
                        }
                    }
                    if (count >= tiddlerCount) {
                        renderTiddler(self.store, self.tiddlerTitle,
                            self.emitter);
                    }
                    count++;
                }, function(err) {
                    tiddlerCount--;
                    if (count >= tiddlerCount) {
                        renderTiddler(self.store, self.tiddlerTitle,
                            self.emitter);
                    }
                });
            } else {
                tiddlerCount--;
                if (count >= tiddlerCount) {
                    renderTiddler(self.store, self.tiddlerTitle,
                        self.emitter);
                }
            }
        }
    }
};

Wikifier.prototype.getTiddler = function(title, callback, errback) {
    var parsed_uri = url.parse(this.contextURI)
        , client = http.createClient(parsed_uri.port ? parsed_uri.port : 80,
            parsed_uri.hostname)
        , self = this;

    client.on('error', function(err) {
        errback(err);
    });

    var path = parsed_uri.pathname + '/' + encodeURIComponent(title);
    var request = client.request('GET', path, {
        'host': parsed_uri.hostname,
        'accept': 'application/json',
        'cookie': this.authToken,
        'user-agent': 'wikifier thang',
        'x-controlview': 'false' // not needed?
    });
    request.end();

    request.on('error', function(error) {
        console.warn('getTiddler error', error, self.contextURI, title);
        errback(error);
    });

    request.on('response', function(response) {
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
};

Wikifier.prototype.getTiddlers = function(dependencies, callback, errback) {
    var parsed_uri = url.parse(this.contextURI)
        , client = http.createClient(parsed_uri.port ? parsed_uri.port : 80,
            parsed_uri.hostname)
        , self = this
        , getTiddlersEmit = new Emitter();

    client.on('error', function(err) {
        errback(err);
    });
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
        errback(err);
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
                callback.apply(self, [dependencies]);
            });
        } else {
            console.warn(response.statusCode, contextURI, title);
            errback('non 200 ' + response.statusCode + ' on ' + title);
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
