// Application class
// Requries a datamodel in the "Model" module
// Manages switching ui components which are views and associated viewmodels
// Views are HTML partial pages, ViewModels are the underlying databindings and behavior
// of the View. The ViewModel should take and return data to the Model object.
define(['knockout', 'underscore', 'jquery', 'guid'],
function (ko, _, $, Guid)
{
    function _ParseJsObject(string)
    {
        // Use 'eval' to create a javascript object from the malformed JSON
        // NOTE: there are some security concerns with this method
        var parenString = '(' + string + ')'; // object literals must be enclosed in parenthesis for eval to work properly
        var obj = eval(parenString);

        return obj;
    }

    // Loads view templates and styles for each component
    function _LoadComponents(app)
    {
        // Put JQuery AJAX into synchronous mode for this algorithm to work, we will clear this flag once page loading is complete
        $.ajaxSetup({ async: false });

        // Preload styles and templates for each component
        _(app.Components()).each(function (comp)
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

    var Application = {

        Model: ko.observable({}),

        Name: ko.observable(''),

        Components: ko.observableArray([]),

        Visible: ko.observable(true),

        Children: ko.observableArray(),

        // Composes the page and applies data bindings
        Compose: function (components)
        {
            this.Components(components);
            _LoadComponents(this);

            var topLevelComponents = $('[data-component]').toArray();
            this.ExpandComponents(topLevelComponents);

            $(this).triggerHandler('Loaded');
            
            ko.applyBindings(this);
        },

        // Activate a component, attached to all child components ViewModels
        Activate: function (params)
        {
            this.Visible(true);
            $(this).triggerHandler('Activate', [params]);
        },

        // Finishes a component, attached to all child components ViewModels
        Finish: function (viewName, params)
        {
            this.Visible(false);
            $(this).triggerHandler('Finish', [params]);
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
        InjectComponent : function (component)
        {
            // Expand the component into the DOM
            var viewModels = this.ExpandComponent(component); 
            
            // Trigger injection handlers for the inserted treee
            _(viewModels).each(function (vm)
            {
                $(vm).triggerHandler('Injected');
            });
            
            // Apply bindings to the root level injected node using its parent
            var parent = viewModels[0].Parent();
            ko.applyBindingsToNode(component, null, parent);
            
            // Return the root of the injected componentsQueue
            return viewModels[0];
        },
        
        // Shorthand to expand a single component
        // returns a tree structure in an array of the expanded components
        ExpandComponent : function(component)
        {
            return this.ExpandComponents([component]);
        },

        // Expands a data-component element into its component, uses a breadth-first traversal
        // Returns a list of the constructed view models that were expanded
        ExpandComponents: function (components)
        {
            var componentsQueue = components;
            var viewModels = [];

            while (componentsQueue.length > 0)
            {
                var componentRoot = $(componentsQueue.shift()); // dequeue operation
                var componentName = componentRoot.data('component');

                // Find the component description
                var component = _(this.Components()).findWhere({ Name: componentName });
                if (component)
                {
                    // Get the components view parameters
                    var params = componentRoot.data('parameters');
                    if (params)
                    {
                        params = _ParseJsObject(params);
                    }

                    // Get the name to use as a field name
                    var fieldName = componentRoot.data('name');

                    // Create the view model and add standard fields
                    var viewModel = new component.ViewModel();
                    viewModel.Visible = ko.observable(false); // Hidden by default
                    viewModel.Name = fieldName;
                    viewModel.ViewParameters = params;
                    viewModel.Children = ko.observableArray();
                    viewModel.Find = this.Find;
                    viewModel.Activate = this.Activate;
                    viewModel.Finish = this.Finish;
                    viewModel.Uid = Guid.NewGuid();
                    viewModel.View = function () { return $('#' + this.Uid); };
                    
                    // Add the view model to the list of view models that were processed
                    viewModels.push(viewModel);

                    // Find the parent of the view, using app when there is no parent
                    var parentRoot = componentRoot.parent().closest('[data-component]');
                    var parent = this;
                    if (parentRoot.length > 0)
                    {
                        var parent = this.Find(parentRoot.attr('id'));
                    }

                    // Add the viewmodel to its parent and add a parent property to the viewmodel
                    parent[fieldName] = ko.observable(viewModel);
                    parent.Children.push(viewModel);
                    viewModel.Parent = ko.observable(parent);

                    // Add databinding for visibility and context to the component root node
                    componentRoot.attr('data-bind', 'visible: ' + fieldName + '().Visible, with:' + fieldName);
                    componentRoot.attr('id', viewModel.Uid);
                    componentRoot.hide();   // Hide by default so that the views don't flash on the screen before knockout kicks in

                    // Compile the view using its parameters
                    var compiledView = _.template(component.Template, params);

                    // Insert the compiled view into the DOM
                    componentRoot.html(compiledView);

                    // Find any child data-component nodes and push them onto the queue
                    var childComponents = componentRoot.find('[data-component]').toArray();
                    _(childComponents).each(function (child)
                    {
                        componentsQueue.push(child);
                    });
                }
            }
            
            return viewModels;
        }
    }
    
    Application.Name.subscribe(function(value)
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

        var nameElements = $('.AppName');
        nameElements.text(value);
    });

    return Application;
});
