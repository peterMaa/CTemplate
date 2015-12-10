/*global define,dojo,dojoConfig,alert,esri,locatorParams,appGlobals */
/*jslint browser:true,sloppy:true,nomen:true,unparam:true,plusplus:true,indent:4 */
/*
 | Copyright 2015 Esri
 |
 | Licensed under the Apache License, Version 2.0 (the "License");
 | you may not use this file except in compliance with the License.
 | You may obtain a copy of the License at
 |
 |    http://www.apache.org/licenses/LICENSE-2.0
 |
 | Unless required by applicable law or agreed to in writing, software
 | distributed under the License is distributed on an "AS IS" BASIS,
 | WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 | See the License for the specific language governing permissions and
 | limitations under the License.
 */
//============================================================================================================================//
define([
    "dojo/_base/array",
    "dojo/_base/declare",
    "dojo/_base/lang",
    "dojo/dom",
    "dojo/dom-attr",
    "dojo/dom-class",
    "dojo/dom-construct",
    "dojo/dom-geometry",
    "dojo/dom-style",
    "dojo/keys",
    "dojo/i18n!application/js/library/nls/localizedStrings",
    "dojo/on",
    "dojo/query",
    "dojo/string",
    "dojo/text!./templates/locatorTemplate.html",
    "dojo/topic",
    "dijit/_TemplatedMixin",
    "dijit/_WidgetBase",
    "dijit/_WidgetsInTemplateMixin",
    "dojo/Deferred",
    "dojo/promise/all",
    "esri/geometry/Point",
    "esri/graphic",
    "esri/layers/GraphicsLayer",
    "esri/symbols/PictureMarkerSymbol",
    "esri/tasks/GeometryService",
    "esri/tasks/locator",
    "esri/tasks/query",
    "esri/tasks/QueryTask",
    "dijit/a11yclick"
], function (Array, declare, lang, dom, domAttr, domClass, domConstruct, domGeom, domStyle, keys, sharedNls, on, query, string, template, topic, _TemplatedMixin, _WidgetBase, _WidgetsInTemplateMixin, Deferred, all, Point, Graphic, GraphicsLayer, PictureMarkerSymbol, GeometryService, Locator, Query, QueryTask, a11yclick) {
    //========================================================================================================================//

    return declare([_WidgetBase, _TemplatedMixin, _WidgetsInTemplateMixin], {
        templateString: template,                                // Variable for template string
        sharedNls: sharedNls,                                    // Variable for shared NLS
        lastSearchString: null,                                  // Variable for last search string
        stagedSearch: null,                                      // Variable for staged search
        preLoaded: true,                                         // Variable for loading the locator widget
        isShowDefaultPushPin: true,                              // Variable to show the default pushpin on map
        selectedGraphic: null,                                   // Variable for selected graphic
        graphicsLayerId: null,                                   // Variable for storing search settings
        configSearchSettings: null,

        /**
        * display locator widget
        * @class
        * @name widgets/locator/locator
        * @method postCreate
        * @return
        */

        postCreate: function () {
            var graphicsLayer;
            /**
            * close locator widget if any other widget is opened
            * @param {string} widget Key of the newly opened widget
            */
            // variable is check if locator widget is loading in another file
            if (this.preLoaded) {
                topic.subscribe("toggleWidget", lang.hitch(this, function (widget) {
                    if (widget !== "locator") {
                        if (domGeom.getMarginBox(this.divAddressContainer).h > 0) {
                            domClass.replace(this.domNode, "esriCTHeaderSearch", "esriCTHeaderSearchSelected");
                            domClass.replace(this.divAddressContainer, "esriCTHideContainerHeight", "esriCTShowContainerHeight");
                            this.txtAddress.blur();
                        }
                    }
                }));
                this.parentDomNode = dom.byId("esriCTParentDivContainer");
                this.domNode = domConstruct.create("div", { "title": sharedNls.tooltips.search, "class": "esriCTHeaderIcons esriCTHeaderSearch" }, null);
                this.own(on(this.domNode, a11yclick, lang.hitch(this, function () {
                    this._toggleTexBoxControls(false);
                    this.onLocateButtonClick();
                    /**
                    * minimize other open header panel widgets and show locator widget
                    */
                    topic.publish("toggleWidget", "locator");
                    this._showHideLocateContainer();
                })));
                this.locatorSettings = appGlobals.configData.LocatorSettings;
                this.defaultAddress = this.locatorSettings.LocatorDefaultAddress;
                domConstruct.place(this.divAddressContainer, this.parentDomNode);
            } else {
                domConstruct.place(this.divAddressContainer.children[0], this.parentDomNode);
            }
            // verify the graphic layer
            if (!this.graphicsLayerId) {
                this.graphicsLayerId = "locatorGraphicsLayer";
                if (Array.indexOf(this.map.graphicsLayerIds, this.graphicsLayerId) !== -1) {
                    this.graphicsLayerId += this.map.graphicsLayerIds.length;
                }
                graphicsLayer = new GraphicsLayer();
                graphicsLayer.id = this.graphicsLayerId;
                this.map.addLayer(graphicsLayer);
            }
            this._setDefaultTextboxValue(this.txtAddress, "defaultAddress", this.defaultAddress);
            this.txtAddress.value = domAttr.get(this.txtAddress, "defaultAddress");
            this.lastSearchString = lang.trim(this.txtAddress.value);
            this._attachLocatorEvents();
            // Subscribe function to clear graphics from map
            topic.subscribe("clearLocatorGraphicsLayer", this._clearGraphics);
        },

        /**
        * Store search settings in an array if the layer url for that particular setting is available
        * @memberOf widgets/locator/locator
        */
        _setSearchSettings: function () {
            var i;
            this.configSearchSettings = [];
            for (i = 0; i < appGlobals.configData.SearchSettings.length; i++) {
                if (appGlobals.configData.SearchSettings[i].QueryURL) {
                    this.configSearchSettings.push(appGlobals.configData.SearchSettings[i]);
                }
            }
        },

        /**
        * Set default value in search textbox as specified in configuration file
        * @param {node} node
        * @param {object} attribute
        * @param {string} value
        * @memberOf widgets/locator/locator
        */
        _setDefaultTextboxValue: function (node, attribute, value) {
            domAttr.set(node, attribute, value);
        },

        /**
        * Attach locator events in this function
        * @memberOf widgets/locator/locator
        */
        _attachLocatorEvents: function () {
            domAttr.set(this.imgSearchLoader, "src", dojoConfig.baseURL + "/js/library/themes/images/loader.gif");
            this.own(on(this.divSearch, a11yclick, lang.hitch(this, function () {
                this._toggleTexBoxControls(true);
                this._locateAddress(true);
            })));
            this.own(on(this.txtAddress, "keyup", lang.hitch(this, function (evt) {
                this._submitAddress(evt);
            })));
            this.own(on(this.txtAddress, "paste", lang.hitch(this, function (evt) {
                this._submitAddress(evt, true);
            })));
            this.own(on(this.txtAddress, "cut", lang.hitch(this, function (evt) {
                this._submitAddress(evt, true);
            })));
            this.own(on(this.txtAddress, "dblclick", lang.hitch(this, function (evt) {
                this._clearDefaultText(evt);
            })));
            this.own(on(this.txtAddress, "blur", lang.hitch(this, function (evt) {
                this._replaceDefaultText(evt);
            })));
            this.own(on(this.txtAddress, "focus", lang.hitch(this, function () {
                domClass.add(this.txtAddress, "esriCTColorChange");
            })));
            this.own(on(this.close, a11yclick, lang.hitch(this, function () {
                this._hideText();
            })));
        },

        /**
        * Handle locate button click
        * @memberOf widgets/locator/locator
        */
        onLocateButtonClick: function () {
            // executed when user clicks on the locate button
            return true;
        },

        /**
        * Hide value from search textbox
        * @memberOf widgets/locator/locator
        */
        _hideText: function () {
            this.txtAddress.value = "";
            this.lastSearchString = lang.trim(this.txtAddress.value);
            domConstruct.empty(this.divAddressResults);
            domClass.remove(this.divAddressContainer, "esriCTAddressContentHeight");
            domAttr.set(this.txtAddress, "defaultAddress", this.txtAddress.value);
        },

        /**
        * Show/hide locator widget and set default search text
        * @memberOf widgets/locator/locator
        */
        _showHideLocateContainer: function () {
            this.txtAddress.blur();
            if (domGeom.getMarginBox(this.divAddressContainer).h > 1) {
                /**
                * when user clicks on locator icon in header panel, close the search panel if it is open
                */
                this._hideAddressContainer();
            } else {
                /**
                * when user clicks on locator icon in header panel, open the search panel if it is closed
                */
                domClass.replace(this.domNode, "esriCTHeaderSearchSelected", "esriCTHeaderSearch");
                domClass.replace(this.txtAddress, "esriCTBlurColorChange", "esriCTColorChange");
                domClass.replace(this.divAddressContainer, "esriCTShowContainerHeight", "esriCTHideContainerHeight");
                domStyle.set(this.txtAddress, "verticalAlign", "middle");
                this.txtAddress.value = domAttr.get(this.txtAddress, "defaultAddress");
                this.lastSearchString = lang.trim(this.txtAddress.value);
            }
        },

        /**
        * Search address on every key press
        * @param {object} evt Keyup event
        * @param {string} locatorText
        * @memberOf widgets/locator/locator
        */
        _submitAddress: function (evt, locatorText) {
            if (locatorText) {
                setTimeout(lang.hitch(this, function () {
                    this._locateAddress(true);
                }), 100);
                return;
            }
            // check the keypress event
            if (evt) {
                /**
                * Enter key immediately starts search
                */
                if (evt.keyCode === keys.ENTER) {
                    this._toggleTexBoxControls(true);
                    this._locateAddress(true);
                    return;
                }
                /**
                * do not perform auto complete search if control &| alt key pressed, except for ctrl-v
                */
                if (evt.ctrlKey || evt.altKey || evt.keyCode === keys.UP_ARROW || evt.keyCode === keys.DOWN_ARROW ||
                        evt.keyCode === keys.LEFT_ARROW || evt.keyCode === keys.RIGHT_ARROW ||
                        evt.keyCode === keys.HOME || evt.keyCode === keys.END ||
                        evt.keyCode === keys.CTRL || evt.keyCode === keys.SHIFT) {
                    evt.cancelBubble = true;
                    if (evt.stopPropagation) {
                        evt.stopPropagation();
                    }
                    this._toggleTexBoxControls(false);
                    return;
                }

                /**
                * call locator service if search text is not empty
                */

                this._locateAddress(false);
            }
        },

        /**
        * Perform search by address if search type is address search
        * @memberOf widgets/locator/locator
        */
        _locateAddress: function (launchImmediately) {
            var searchText = lang.trim(this.txtAddress.value).replace(/'/g, "''");
            if (launchImmediately || this.lastSearchString !== searchText) {
                this._toggleTexBoxControls(true);
                this.lastSearchString = searchText;

                // Clear any staged search
                clearTimeout(this.stagedSearch);

                // Hide existing results
                domConstruct.empty(this.divAddressResults);
                /**
                * stage a new search, which will launch if no new searches show up
                * before the timeout
                */
                this.stagedSearch = setTimeout(lang.hitch(this, function () {
                    var thisSearchTime;

                    // Replace the close button in search textbox with search loader icon
                    this._toggleTexBoxControls(false);
                    // Launch a search after recording when the search began
                    this.lastSearchTime = thisSearchTime = (new Date()).getTime();
                    this._searchLocation(searchText, thisSearchTime);
                }), (launchImmediately ? 0 : 500));
            }
        },

        /**
        * Query geocoder service and store search results in an array
        * @memberOf widgets/locator/locator
        */
        _searchLocation: function (searchText, thisSearchTime) {
            var nameArray = {}, locatorSettings, locator, searchFieldName, addressField, baseMapExtent, options, searchFields, addressFieldValues, s, deferredArray,
                locatorDef, deferred, resultLength, index, resultAttributes, key, order, basemapId, selectedBasemap = appGlobals.configData.BaseMapLayers[appGlobals.shareOptions.selectedBasemapIndex];
            // Discard searches made obsolete by new typing from user
            if (thisSearchTime < this.lastSearchTime) {
                return;
            }
            if (searchText === "") {
                // Short-circuit and clear results if the search string is empty

                this._toggleTexBoxControls(true);
                this.mapPoint = null;
                this._locatorErrBack(true);
            } else {
                nameArray[this.locatorSettings.DisplayText] = [];
                domAttr.set(this.txtAddress, "defaultAddress", searchText);

                /**
                * call locator service specified in configuration file
                */
                locatorSettings = this.locatorSettings;
                locator = new Locator(locatorSettings.LocatorURL);
                searchFieldName = locatorSettings.LocatorParameters.SearchField;
                addressField = {};
                addressField[searchFieldName] = searchText;
                //get full extent of selected basemap
                if (selectedBasemap.length) {
                    basemapId = selectedBasemap[0].BasemapId;
                } else {
                    basemapId = selectedBasemap.BasemapId;
                }
                if (this.map.getLayer(basemapId)) {
                    baseMapExtent = this.map.getLayer(basemapId).fullExtent;
                }
                options = {};
                options.address = addressField;
                options.outFields = locatorSettings.LocatorOutFields;
                options[locatorSettings.LocatorParameters.SearchBoundaryField] = baseMapExtent;
                locator.outSpatialReference = this.map.spatialReference;
                searchFields = [];
                addressFieldValues = locatorSettings.FilterFieldValues;
                for (s in addressFieldValues) {
                    if (addressFieldValues.hasOwnProperty(s)) {
                        searchFields.push(addressFieldValues[s]);
                    }
                }
                // Discard searches made obsolete by new typing from user
                if (thisSearchTime < this.lastSearchTime) {
                    return;
                }

                /**
                * get results from locator service
                * @param {object} options Contains address, outFields and basemap extent for locator service
                * @param {object} candidates Contains results from locator service
                */
                deferredArray = [];
                if (!this.configSearchSettings || !this.preLoaded) {
                    this._setSearchSettings();
                }
                for (index = 0; index < this.configSearchSettings.length; index++) {
                    this._layerSearchResults(searchText, deferredArray, this.configSearchSettings[index]);
                }
                locatorDef = locator.addressToLocations(options);
                locator.on("address-to-locations-complete", lang.hitch(this, function (candidates) {
                    deferred = new Deferred();
                    deferred.resolve(candidates);
                    return deferred.promise;
                }), function () {
                    this._locatorErrBack(true);
                });
                deferredArray.push(locatorDef);
                all(deferredArray).then(lang.hitch(this, function (result) {
                    var num, results;
                    // Discard searches made obsolete by new typing from user
                    if (thisSearchTime < this.lastSearchTime) {
                        return;
                    }
                    if (result) {
                        if (result.length > 0) {
                            for (num = 0; num < result.length; num++) {
                                if (result[num]) {
                                    if (result[num].layerSearchSettings) {
                                        key = result[num].layerSearchSettings.SearchDisplayTitle;
                                        nameArray[key] = [];
                                        if (result[num].featureSet && result[num].featureSet.features) {
                                            for (order = 0; order < result[num].featureSet.features.length; order++) {
                                                resultAttributes = result[num].featureSet.features[order].attributes;
                                                for (results in resultAttributes) {
                                                    if (resultAttributes.hasOwnProperty(results)) {
                                                        if (!resultAttributes[results]) {
                                                            resultAttributes[results] = appGlobals.configData.ShowNullValueAs;
                                                        }
                                                    }
                                                }
                                                if (nameArray[key].length < this.locatorSettings.MaxResults) {
                                                    nameArray[key].push({
                                                        name: string.substitute(result[num].layerSearchSettings.SearchDisplayFields, resultAttributes),
                                                        attributes: resultAttributes,
                                                        fields: result[num].featureSet.fields,
                                                        layer: result[num].layerSearchSettings,
                                                        geometry: result[num].featureSet.features[order].geometry
                                                    });
                                                }
                                            }
                                        }
                                    } else if (result[num].length) {
                                        this._addressResult(result[num], nameArray, searchFields);
                                    }
                                    if (result[num].length) {
                                        //result length in case of address
                                        resultLength = result[num].length;
                                    } else if (result[num].featureSet && result[num].featureSet.features.length > 0) {
                                        //result length in case of features
                                        resultLength = result[num].featureSet.features.length;
                                    }
                                }
                            }
                            this._showLocatedAddress(searchText, nameArray, resultLength);
                        }
                    } else {
                        this.mapPoint = null;
                        this._locatorErrBack(true);
                    }
                }));
            }
        },

        /**
        * Query the layers having search settings configured in the config file
        * @param {array} deferredArray
        * @param {object} layerobject
        * @memberOf widgets/locator/locator
        */
        _layerSearchResults: function (searchText, deferredArray, layerobject) {
            var queryTask, queryLayer, deferred, currentTime, featureObject;
            this._toggleTexBoxControls(true);
            if (layerobject.QueryURL) {
                deferred = new Deferred();
                if (layerobject.UnifiedSearch.toLowerCase() === "true") {
                    currentTime = new Date();
                    queryTask = new QueryTask(layerobject.QueryURL);
                    queryLayer = new Query();
                    queryLayer.where = string.substitute(layerobject.SearchExpression, [searchText.toUpperCase()]) + " AND " + currentTime.getTime().toString() + "=" + currentTime.getTime().toString();
                    queryLayer.outSpatialReference = this.map.spatialReference;
                    queryLayer.returnGeometry = layerobject.ObjectID ? false : true;
                    queryLayer.outFields = ["*"];
                    queryTask.execute(queryLayer, lang.hitch(this, function (featureSet) {
                        featureObject = {
                            "featureSet": featureSet,
                            "layerSearchSettings": layerobject
                        };
                        deferred.resolve(featureObject);
                    }), function (err) {
                        alert(err.message);
                        deferred.resolve();
                    });
                } else {
                    deferred.resolve();
                }
                deferredArray.push(deferred);
            }
        },

        /**
        * Grouping search results
        * @param {object} candidates contains the search data
        * @param {array} nameArray
        * @param {field} searchFields
        * @memberOf widgets/locator/locator
        */
        _addressResult: function (candidates, nameArray, searchFields) {
            var order, j;
            for (order = 0; order < candidates.length; order++) {
                if (candidates[order].attributes[this.locatorSettings.AddressMatchScore.Field] > this.locatorSettings.AddressMatchScore.Value) {
                    for (j in searchFields) {
                        if (searchFields.hasOwnProperty(j)) {
                            if (candidates[order].attributes[this.locatorSettings.FilterFieldName] === searchFields[j]) {
                                if (nameArray[this.locatorSettings.DisplayText].length < this.locatorSettings.MaxResults) {
                                    nameArray[this.locatorSettings.DisplayText].push({
                                        name: string.substitute(this.locatorSettings.DisplayField, candidates[order].attributes),
                                        attributes: candidates[order]
                                    });
                                }
                            }
                        }
                    }
                }
            }
        },

        /**
        * Filter valid results from results returned by locator service
        * @param {object} candidates contains results from locator service
        * @param {} resultLength
        * @memberOf widgets/locator/locator
        */
        _showLocatedAddress: function (searchText, candidates, resultLength) {
            var addrListCount = 0, noResultCount = 0, candidatesCount = 0, addrList = [], candidateArray, divAddressCounty, candidate, listContainer, i, divAddressSearchCell;
            domConstruct.empty(this.divAddressResults);

            if (lang.trim(searchText) === "") {
                this.txtAddress.focus();
                domConstruct.empty(this.divAddressResults);
                this._toggleTexBoxControls(false);
                return;
            }

            /**
            * display all the located address in the address container
            * 'this.divAddressResults' div dom element contains located addresses, created in widget template
            */

            if (resultLength > 0) {
                domClass.add(this.divAddressContainer, "esriCTAddressContentHeight");
                this._toggleTexBoxControls(false);
                for (candidateArray in candidates) {
                    if (candidates.hasOwnProperty(candidateArray)) {
                        candidatesCount++;
                        if (candidates[candidateArray].length > 0) {
                            divAddressCounty = domConstruct.create("div", {
                                "class": "esriCTSearchGroupRow esriCTBottomBorder esriCTResultColor esriCTCursorPointer esriCTAddressCounty"
                            }, this.divAddressResults);
                            divAddressSearchCell = domConstruct.create("div", { "class": "esriCTSearchGroupCell" }, divAddressCounty);
                            candidate = candidateArray + " (" + candidates[candidateArray].length + ")";
                            domConstruct.create("span", { "innerHTML": "+", "class": "esriCTPlusMinus" }, divAddressSearchCell);
                            domConstruct.create("span", { "innerHTML": candidate, "class": "esriCTGroupList" }, divAddressSearchCell);
                            addrList.push(divAddressSearchCell);
                            this._toggleAddressList(addrList, addrListCount);
                            addrListCount++;
                            listContainer = domConstruct.create("div", { "class": "esriCTListContainer esriCTHideAddressList" }, this.divAddressResults);

                            for (i = 0; i < candidates[candidateArray].length; i++) {
                                this._displayValidLocations(candidates[candidateArray][i], i, candidates[candidateArray], listContainer);
                            }
                        } else {
                            noResultCount++;
                        }
                    }
                }
                if (noResultCount === candidatesCount) {
                    this.mapPoint = null;
                    this._locatorErrBack(true);
                }
            } else {
                this.mapPoint = null;
                this._locatorErrBack(true);
            }
        },

        /**
        * Show and hide address list
        * @param {array} addressList
        * @param {index} idx
        * @memberOf widgets/locator/locator
        */
        _toggleAddressList: function (addressList, idx) {
            on(addressList[idx], a11yclick, lang.hitch(this, function (evt) {
                var listContainer, listStatusSymbol;
                listContainer = query(".esriCTListContainer", this.divAddressResults)[idx];
                if (domClass.contains(listContainer, "esriCTShowAddressList")) {
                    domClass.toggle(listContainer, "esriCTShowAddressList");
                    listStatusSymbol = (domAttr.get(query(".esriCTPlusMinus", evt.currentTarget)[0], "innerHTML") === "+") ? "-" : "+";
                    domAttr.set(query(".esriCTPlusMinus", evt.currentTarget)[0], "innerHTML", listStatusSymbol);
                    return;
                }
                domClass.add(listContainer, "esriCTShowAddressList");
                domAttr.set(query(".esriCTPlusMinus", evt.currentTarget)[0], "innerHTML", "-");
            }));
        },

        /**
        * Display valid results in search panel
        * @param {object} candidate Contains valid result to be displayed in search panel
        * @param {number} index
        * @param {array} candidateArray
        * @param {node} listContainer
        * @memberOf widgets/locator/locator
        */
        _displayValidLocations: function (candidate, index, candidateArray, listContainer) {
            var candidateAddress, divAddressRow, layer, infoIndex;
            divAddressRow = domConstruct.create("div", { "class": "esriCTCandidateList" }, listContainer);
            candidateAddress = domConstruct.create("div", { "class": "esriCTContentBottomBorder esriCTCursorPointer" }, divAddressRow);
            domAttr.set(candidateAddress, "index", index);
            try {
                if (candidate.name) {
                    domAttr.set(candidateAddress, "innerHTML", candidate.name);
                } else {
                    domAttr.set(candidateAddress, "innerHTML", candidate);
                }
                if (candidate.attributes.location) {
                    domAttr.set(candidateAddress, "x", candidate.attributes.location.x);
                    domAttr.set(candidateAddress, "y", candidate.attributes.location.y);
                    domAttr.set(candidateAddress, "address", string.substitute(this.locatorSettings.DisplayField, candidate.attributes.attributes));
                }
            } catch (err) {
                alert(sharedNls.errorMessages.falseConfigParams);
            }

            /**
            * candidate on click of result
            * @param {node} listContainer
            */
            on(candidateAddress, a11yclick, lang.hitch(this, function (evt) {
                var target;
                topic.publish("showProgressIndicator");
                this.txtAddress.value = candidateAddress.innerHTML;
                domAttr.set(this.txtAddress, "defaultAddress", this.txtAddress.value);
                this._hideAddressContainer();
                if (this.isShowDefaultPushPin) {
                    if (candidate.attributes.location) {
                        target = evt.currentTarget || evt.srcElement;
                        this.mapPoint = new Point(Number(domAttr.get(target, "x")), Number(domAttr.get(target, "y")), this.map.spatialReference);
                        this._locateAddressOnMap(this.mapPoint);
                        this.candidateClicked(candidate);
                    } else {
                        if (candidateArray[domAttr.get(candidateAddress, "index", index)]) {
                            layer = candidateArray[domAttr.get(candidateAddress, "index", index)].layer;
                            for (infoIndex = 0; infoIndex < this.configSearchSettings.length; infoIndex++) {
                                if (this.configSearchSettings[infoIndex] && this.configSearchSettings[infoIndex].QueryURL === layer.QueryURL) {
                                    if (!candidate.geometry) {
                                        this._getSelectedCandidateGeometry(layer, candidate);
                                    } else {
                                        this._showFeatureResultsOnMap(candidate);
                                        topic.publish("hideProgressIndicator");
                                        this.candidateClicked(candidate);
                                    }
                                }
                            }
                        }
                    }
                }
            }));
        },

        /**
        * Get geometry of the selected candidate by querying the layer
        * @param {object} layerobject
        * @param {object} candidate
        * @memberOf widgets/locator/locator
        */
        _getSelectedCandidateGeometry: function (layerobject, candidate) {
            var queryTask, queryLayer, currentTime;
            if (layerobject.QueryURL) {
                currentTime = new Date();
                queryTask = new QueryTask(layerobject.QueryURL);
                queryLayer = new Query();
                queryLayer.where = layerobject.ObjectID + " =" + candidate.attributes[layerobject.ObjectID] + " AND " + currentTime.getTime().toString() + "=" + currentTime.getTime().toString();
                queryLayer.outSpatialReference = this.map.spatialReference;
                queryLayer.returnGeometry = true;
                queryTask.execute(queryLayer, lang.hitch(this, function (featureSet) {
                    this._showFeatureResultsOnMap(candidate);
                    candidate.geometry = featureSet.features[0].geometry;
                    this.candidateClicked(candidate);
                    topic.publish("hideProgressIndicator");
                }), function (err) {
                    alert(err.message);
                    topic.publish("hideProgressIndicator");
                });
            }
        },

        /**
        * handler for candidate address click
        * @memberOf widgets/locator/locator
        */
        candidateClicked: function (candidate) {
            // selected address will be returned
            return candidate;
        },

        /**
        * show the feature result on map
        * @param {object} candidate
        * @memberOf widgets/locator/locator
        */
        _showFeatureResultsOnMap: function (candidate) {
            this.txtAddress.value = candidate.name;
        },

        /**
        * Show/hide the close icon and search loader icon present in search textbox
        * @param {boolean} isShow
        * @memberOf widgets/locator/locator
        */
        _toggleTexBoxControls: function (isShow) {
            if (isShow) {
                domStyle.set(this.imgSearchLoader, "display", "block");
                domStyle.set(this.close, "display", "none");
            } else {
                domStyle.set(this.imgSearchLoader, "display", "none");
                domStyle.set(this.close, "display", "block");
            }
        },
        /**
        * Add the pushpin to graphics layer
        * @param {object} mapPoint
        * @memberOf widgets/locator/locator
        */
        _locateAddressOnMap: function (mapPoint) {
            var geoLocationPushpin, locatorMarkupSymbol;
            this._clearGraphics();
            geoLocationPushpin = dojoConfig.baseURL + this.locatorSettings.DefaultLocatorSymbol;
            locatorMarkupSymbol = new PictureMarkerSymbol(geoLocationPushpin, this.locatorSettings.MarkupSymbolSize.width, this.locatorSettings.MarkupSymbolSize.height);
            this.selectedGraphic = new Graphic(mapPoint, locatorMarkupSymbol, {}, null);
            this.map.getLayer(this.graphicsLayerId).add(this.selectedGraphic);
            topic.publish("hideProgressIndicator");
            this.onGraphicAdd();
        },

        /**
        * Clear graphics from map
        * @memberOf widgets/locator/locator
        */
        _clearGraphics: function () {
            if (this.map.getLayer(this.graphicsLayerId)) {
                this.map.getLayer(this.graphicsLayerId).clear();
            }
            this.selectedGraphic = null;
        },

        /**
        * Handler for adding graphic on map
        * @memberOf widgets/locator/locator
        */
        onGraphicAdd: function () {
            return true;
        },

        /**
        * Hide search panel
        * @memberOf widgets/locator/locator
        */
        _hideAddressContainer: function () {
            domClass.replace(this.domNode, "esriCTHeaderSearch", "esriCTHeaderSearchSelected");
            this.txtAddress.blur();
            domClass.replace(this.divAddressContainer, "esriCTHideContainerHeight", "esriCTShowContainerHeight");
        },

        /**
        * Display error message if locator service fails or does not return any results
        * @memberOf widgets/locator/locator
        */
        _locatorErrBack: function (showMessage) {
            domConstruct.empty(this.divAddressResults);
            domClass.remove(this.divAddressContainer, "esriCTAddressContentHeight");
            domStyle.set(this.divAddressResults, "display", "block");
            domClass.add(this.divAddressContent, "esriCTAddressResultHeight");
            this._toggleTexBoxControls(false);
            if (showMessage) {
                domConstruct.create("div", { "class": "esriCTDivNoResultFound", "innerHTML": sharedNls.errorMessages.invalidSearch }, this.divAddressResults);
            }
        },

        /**
        * Clear default value from search textbox
        * @param {object} evt double click event
        * @memberOf widgets/locator/locator
        */
        _clearDefaultText: function (evt) {
            var target = window.event ? window.event.srcElement : evt ? evt.target : null;
            if (!target) {
                return;
            }
            target.style.color = "#FFF";
            target.value = '';
            this.txtAddress.value = "";
            domAttr.set(this.txtAddress, "defaultAddress", this.txtAddress.value);
        },

        /**
        * Set default value to search textbox
        * @param {event} evt Blur event
        * @memberOf widgets/locator/locator
        */
        _replaceDefaultText: function (evt) {
            var target = window.event ? window.event.srcElement : evt ? evt.target : null;
            if (!target) {
                return;
            }
            this._resetTargetValue(target, "defaultAddress");
        },

        /**
        * Set default value to search textbox
        * @param {object} target Textbox dom element
        * @param {string} title Default value
        * @memberOf widgets/locator/locator
        */
        _resetTargetValue: function (target, title) {
            if (target.value === '' && domAttr.get(target, title)) {
                target.value = target.title;
                if (target.title === "") {
                    target.value = domAttr.get(target, title);
                }
            }
            if (domClass.contains(target, "esriCTColorChange")) {
                domClass.remove(target, "esriCTColorChange");
            }
            domClass.add(target, "esriCTBlurColorChange");
            this.lastSearchString = lang.trim(this.txtAddress.value);
        }
    });
});
