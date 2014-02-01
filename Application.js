// Application class
// Requries a datamodel in the "Model" module
// Manages switching ui components which are views and associated viewmodels
// Views are HTML partial pages, ViewModels are the underlying databindings and behavior
// of the View. The ViewModel should take and return data to the Model object.
define(['knockout', 'underscore', 'jquery', 'guid'],
function (ko, _, $, Guid)
{
    // Page Composition Algorithm:
    // -----------------------------------
    // 1. Find all data-component nodes and insert into queue (processing the DOM breadth-first)
    // 2. Take a node off the queue, parse the nodes parameters if any
    // 3. Add events and fields to the node and loaded component 
    // 4. Find the components parent, use Application if none, and add variable containers for that component
    // 5. Add visibility and context databindings to the root node
    // 6. Insert the expanded template into the components root as html
    // 7. Parse the components html children for data-component nodes and add them to the queue
    // 8. When the queue is empty, the page is finished loading

    // Application public interface
    var Application = {

        Model: ko.observable({}),

        Name: ko.observable(''),

        Components: ko.observableArray([]),

        Visible: ko.observable(true),

        Children: ko.observableArray(),

        // Composes the page and applies data bindings
        Compose: function (components)
        {
            $('body').attr('data-bind', 'visible: Visible');

            this.Components(components);
            LoadComponents();

            // Apply initial component types
            TypeComponents($('body'));

            var topLevelComponents = $('[data-component]').toArray();
            var expandedModels = ExpandComponents(topLevelComponents);

            // trigger loaded event from bottom up
            expandedModels.reverse();
            _(expandedModels).each(function (comp) { comp.Loaded.Trigger(); });

            // Finally trigger that the application as a whole is loaded
            this.Loaded.Trigger();

            ko.applyBindings(this);
        },

        // Find an component by id using a depth first search (recursive)
        Find: function (componentId)
        {
            var target = null;

            _(this.Children()).each(function (child)
            {
                var foundChild = null;
                if (child.Uid == componentId)
                {
                    foundChild = child;
                }
                else
                {
                    foundChild = child.Find(componentId);
                }

                if (foundChild != null)
                {
                    target = foundChild;
                }
            });

            return target;
        },

        // Inject a component dynamically
        InjectComponent: function (component)
        {
            // Expand the component into the DOM
            var viewModels = ExpandComponent(component);
            viewModels.reverse();

            // Trigger loaded handlers from the bottom up
            _(viewModels).each(function (vm) { vm.Loaded.Trigger(); });

            // Apply bindings to the root level injected node using its parent
            var parent = _(viewModels).last().Parent();
            ko.applyBindingsToNode(component, null, parent);

            // Return the root of the injected componentsQueue
            return _(viewModels).last();
        },

        // Event prototype
        Event: function (id)
        {
            // Generate a unique id if one was not provided
            if (id)
            {
                this.Id = id;
            }
            else
            {
                this.Id = Guid.NewGuid();
            }

            // Attaches an event handler
            this.On = _.bind(function ()
            {
                var args = $.makeArray(arguments);

                return $(this).on.apply($(this), [this.Id].concat(args));
            }, this);

            // Detaches an event handler
            this.Off = _.bind(function ()
            {
                var args = $.makeArray(arguments);

                return $(this).off.apply($(this), [this.Id].concat(args));
            }, this);

            // Triggers the event			
            this.Trigger = _.bind(function ()
            {
                return $(this).triggerHandler(this.Id, arguments);
            }, this);
        },

        RoutedEvent: function (id)
        {
            this.prototype = new Event(id);

            this.TriggerRoute = _.bind(function ()
            {
                this.Trigger.apply(this, arguments);
            }, this);

            this.AddRoute = _.bind(function (ev)
            {
                ev.On(this.TriggerRoute);
            }, this);

            this.RemoveRoute = _.bind(function (ev)
            {
                ev.Off(this.TriggerRoute);
            }, this);
        },

        // Viewmodel prototype parent
        ViewModel: function ()
        {
            // Observable property controls visibility
            this.Visible = ko.observable(false);

            // Parent, children, and find child function
            this.Parent = ko.observable({});
            this.Children = ko.observableArray([]);
            this.Find = _.bind(Application.Find, this);

            // Loaded event, fired after the components view is added and its viewmodel is set up
            this.Loaded = new Application.Event();

            // Tracks if a component is active, not settable
            var isActive = false;
            this.Active = function () { return isActive; } // Tracks if the component is active

            // Activates the component, any number of arguments can be passed to the activation handlers			
            this.Activate = _.bind(function ()
            {
                this.Visible(true);
                isActive = true;

                if (this.View && this.View().data('componentType') == 'collection')
                {
                    var data = ko.dataFor(this.View().get(0));

                    var args = $.makeArray(arguments);

                    var params = args.concat(data);
                    this.Activated.Trigger.apply(this.Activated, params);
                }
                else
                {
                    this.Activated.Trigger.apply(this.Activated, arguments);
                }
            }, this);
            this.Activated = new Application.Event(); // Activated event

            // Finishes the component, any number of arguments can be passed to the finish handlers
            this.Finish = _.bind(function ()
            {
                this.Visible(false);
                isActive = false;
                this.Finished.Trigger.apply(this.Finished, arguments);
            }, this);
            this.Finished = new Application.Event(); // Finish event

            // Unique identifier
            this.Uid = Guid.NewGuid();

            // Gets the root of the components view
            this.View = _.bind(function () { return $('#' + this.Uid); }, this);

            // Removes the component's view which triggers removal of the entire component
            this.Remove = _.bind(function () { this.View().remove(); }, this);
            this.Removed = new Application.Event(); // Removed event
            this.ChildRemoved = new Application.Event(); // Child removed event

            this.Events() = _.bind(function ()
            {
                return _.chain(this)
                        .filter(function (prop)
                        {
                            return prop instanceof Application.Event;
                        })
                        .map(function (prop, name)
                        {
                            return { Name: name, Event: prop };
                        })
                        .value();
            }, this);
        },

        ViewModelCollection: function ()
        {
            this.prototype = [];

            this.Activate = _.bind(function ()
            {
                _(this).each(function (vm)
                {
                    vm.Activate.apply(vm, arguments);
                });
            }, this);
            this.Activated = new Application.Event();

            this.Finish = _.bind(function ()
            {
                _(this).each(function (vm)
                {
                    vm.Finish.apply(vm, arguments);
                });
            }, this);

            this.push = _.bind(function ()
            {
                _(arguments).each(function (arg)
                {
                    if (arg instanceof Application.ViewModel)
                    {
                        var events = arg.Events();

                        _(events).each(function (ev)
                        {
                            if (!(ev.Name in this))
                            {
                                this[ev.Name] = new Application.RoutedEvent();
                            }

                            this[ev.Name].AddRoute(ev.Event);

                        }, this);
                    }
                }, this);

                Array.prototype.push.apply(this, arguments);
            }, this);

            this.remove = _.bind(function ()
            {
                _(arguments).each(function (arg)
                {
                    if (arg instanceof Application.ViewModel)
                    {
                        if (this.indexOf(arg) != -1)
                        {
                            this.slice(this.indexOf(arg), 1);

                            var events = arg.Events();

                            _(events).each(function (ev)
                            {
                                if (ev.Name in this)
                                {
                                    this[ev.Name].RemoveRoute(ev.Event);
                                }
                            }, this);
                        }
                    }
                }, this);
            }, this);
        }
    }

    // Application events
    Application.Loaded = new Application.Event();   // Triggered when the application is finished loading

    Application.ChildRemoved = new Application.Event(); // Triggered when a direct child of Application is removed

    // Application private interface

    // Parses a javascript object from a string, NOT json
    function ParseJsObject(string)
    {
        // Use 'eval' to create a javascript object from the malformed JSON
        // NOTE: there are some security concerns with this method
        var parenString = '(' + string + ')'; // object literals must be enclosed in parenthesis for eval to work properly
        var obj = eval(parenString);

        return obj;
    }

    // Loads view templates and styles for each component
    function _LoadComponents()
    {
        // Put JQuery AJAX into synchronous mode for this algorithm to work, we will clear this flag once page loading is complete
        $.ajaxSetup({ async: false });

        // Preload styles and templates for each component
        _(this.Components()).each(function (comp)
        {
            // Append the style node to the pages head
            if ('Style' in comp)
            {
                var styleLink = $('<link rel="stylesheet" type="text/css" href="' + comp.Style + '"/>');
                $('head').append(styleLink);
            }

            // Load the view template and store it for later
            $.get(comp.View, {}, function (viewData)
            {
                comp.Template = viewData;
            });
        });

        // Put JQuery back into asynchronous mode for future ajax requests
        $.ajaxSetup({ async: true });
    }
    var LoadComponents = _.bind(_LoadComponents, Application);

    // Shorthand to expand a single component
    // returns a tree structure in an array of the expanded components
    function _ExpandComponent(component)
    {
        return ExpandComponents([component]);
    }
    var ExpandComponent = _.bind(_ExpandComponent, Application);

    // Expands a data-component element into its component, uses a breadth-first traversal
    // Returns a list of the constructed view models that were expanded
    function _ExpandComponents(components)
    {
        var componentsQueue = components;
        var viewModels = [];

        while (componentsQueue.length > 0)
        {
            var componentRoot = $(componentsQueue.shift()); // dequeue operation
            var componentName = componentRoot.data('component');

            // Check the component type to make sure it isnt a collection component
            var componentType = componentRoot.data('componentType');
            if (componentType != 'collection' && componentType != 'conditional')
            {
                // Find the component description
                var component = _(this.Components()).findWhere({ Name: componentName });
                if (component)
                {
                    var viewModel = BuildComponent(componentRoot, component);

                    // Add the view model to the list of view models that were processed
                    viewModels.push(viewModel);

                    // Find any child data-component nodes and push them onto the queue
                    var childComponents = componentRoot.find('[data-component]').toArray();
                    _(childComponents).each(function (child)
                    {
                        componentsQueue.push(child);
                    });
                }
            }
        }

        return viewModels;
    }
    var ExpandComponents = _.bind(_ExpandComponents, Application);

    // Dom node removal observer, used to clean up viewmodels when their views are removed
    var domObserver = new MutationObserver(function (mutations)
    {
        // This pipeline is optimized to remove any extra processing
        _.chain(mutations)
        .filter(function (mutation) { return mutation.removedNodes.length > 0; }) // Remove any mutation events that arent removals
        .pluck('removedNodes') // Operate only on the lists of removed nodes
        .map(function (nodeList) { return $.makeArray(nodeList); }) // Turn the nodelists into an array that underscore can manipulate
        .flatten() // Flatten the removals into one array of data to prevent nested pipelines
        .filter(function (node) { return $(node).data('component'); }) // Remove any DOM events not referring to component nodes
        .each(function (node) // Finally, process each component node
        {
            // Get the unique id of the component
            var uid = $(node).attr('id');

            // Find the viewmodel
            var viewModel = Application.Find(uid);

            // If no viewmodel was found, its parent was removed already, this can be ignored
            if (viewModel)
            {
                // Get the parent and field name
                var fieldName = $(node).data('name');
                var parent = viewModel.Parent();

                // Collection nodes need extra processing
                if ($(node).data('componentType') == 'collection')
                {
                    // Remove the viewmodel from the collection in the parent
                    delete parent[fieldName][viewModel.Uid];
                }
                else
                {
                    // Non collection components can have their property removed from the parent
                    delete parent[fieldName];
                }

                // Remove the component from the parents Child list
                var childIndex = parent.Children.indexOf(viewModel);
                if (childIndex > -1)
                {
                    parent.Children.splice(childIndex, 1);
                }

                // Trigger removal events
                viewModel.Removed.Trigger();
                parent.ChildRemoved.Trigger(viewModel);
            }
        });
    });

    function _BuildComponent(componentRoot, component, type)
    {
        // Get the components view parameters
        var params = componentRoot.data('parameters');
        if (params)
        {
            params = ParseJsObject(params);
        }

        // Get the name to use as a field name
        var fieldName = componentRoot.data('name');

        // Create the view model and add standard fields
        var viewModelProto = new Application.ViewModel();
        var componentCopy = $.extend(true, {}, component);
        componentCopy.ViewModel.prototype = viewModelProto;
        var viewModel = new componentCopy.ViewModel();

        // Find the parent of the view, using app when there is no parent
        var parentRoot = componentRoot.parent().closest('[data-component]');
        var parent = this;
        if (parentRoot.length > 0)
        {
            var parent = this.Find(parentRoot.attr('id'));
        }

        // Add the viewmodel to its parent and add a parent property to the viewmodel
        parent.Children.push(viewModel);
        viewModel.Parent(parent);

        if (type != 'collection')
        {
            // Add component property to parent 
            parent[fieldName] = ko.observable(viewModel);

            // Listen for removal events
            domObserver.observe(componentRoot.parent().get(0), { childList: true });

            // Add databinding for visibility and context to the component root node
            componentRoot.attr('data-bind', 'visible: ' + fieldName + '().Visible, with: ' + fieldName);
        }
        else
        {
            // Add the component to the collection property
            parent[fieldName][viewModel.Uid] = ko.observable(viewModel);

            for (var prop in parent[fieldName])
            {
                if (parent[fieldName][prop] instanceof Application.Event)
                {
                    viewModel[prop] = parent[fieldName][prop];
                }
            }

            // Listen for removal events
            domObserver.observe(componentRoot.parent().get(0), { childList: true });

            // Add databinding for visibility and context to the component root node
            componentRoot.attr('data-bind', 'visible: $parent.' + fieldName + '["' + viewModel.Uid + '"]().Visible, with: $parent.' + fieldName + '["' + viewModel.Uid + '"]');
        }

        componentRoot.attr('id', viewModel.Uid);
        componentRoot.hide();   // Hide by default so that the views don't flash on the screen before knockout kicks in

        // Compile the view using its parameters
        var compiledView = _.template(component.Template, params);

        // Insert the compiled view into the DOM
        componentRoot.html(compiledView);

        // Type any child components
        TypeComponents(componentRoot);

        // Get any child collection components and add fields for them so that collection-wide event handlers can be attached 
        var childCollections = componentRoot.find('[data-component-type="collection"]');
        _(childCollections).each(function (collection)
        {
            var collectionName = $(collection).data('name');
            viewModel[collectionName] = {};

            var collectionComponentName = $(collection).data('component');
            var collectionComponentPrototype = _(Application.Components()).findWhere({ Name: collectionComponentName });

            var viewModelProto = new Application.ViewModel();
            var componentCopy = $.extend(true, {}, collectionComponentPrototype);
            componentCopy.ViewModel.prototype = viewModelProto;

            var collectionComponentInstance = new componentCopy.ViewModel();

            for (var prop in collectionComponentInstance)
            {
                if (collectionComponentInstance[prop] instanceof Application.Event)
                {
                    viewModel[collectionName][prop] = new Application.Event();
                }
            }
        });

        return viewModel;
    }
    var BuildComponent = _.bind(_BuildComponent, Application);

    function TypeComponents(root)
    {
        // Select foreach data-binds and mark components inside as having type "collection"
        var collectionComponents = root.find('[data-bind*="foreach:"] [data-component]');
        collectionComponents.attr('data-component-type', 'collection');

        // Select if and ifnot data-binds and mark components inside as having type "conditional"
        var conditionalComponents = root.find('[data-bind*="if:"] [data-component],[data-bind*="ifnot:"] [data-component]');
        conditionalComponents.attr('data-component-type', 'conditional');
    }

    // Updates the title element when the application name is set
    Application.Name.subscribe(function (value)
    {
        var titleElem = $('title');
        if (titleElem.length > 0)
        {
            titleElem.text(value);
        }
        else
        {
            titleElem = $('<title>' + value + '</title>');
            $('head').append(titleElem);
        }
    });

    // Add node processor for foreach bindings
    ko.bindingProvider.instance.preprocessNode = function (node)
    {
        var componentType = $(node).data('componentType');
        var componentName = $(node).data('component');

        if (componentType)
        {
            // Find the component description
            var component = _(Application.Components()).findWhere({ Name: componentName });
            if (component)
            {
                var viewModel = BuildComponent($(node), component, componentType);

                var childComponents = viewModel.View().find('[data-component]').toArray();
                var expandedModels = ExpandComponents(childComponents);

                // trigger loaded event from bottom up
                expandedModels.reverse();
                _(expandedModels).each(function (comp) { comp.Loaded.Trigger(); });

                viewModel.Loaded.Trigger();

                if (viewModel.Parent().Active())
                    viewModel.Activated.Trigger();
            }
        }
    };

    return Application;
});
