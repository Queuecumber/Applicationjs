// Application class
// Requries a datamodel in the "Model" module
// Manages switching ui components which are views and associated viewmodels
// Views are HTML partial pages, ViewModels are the underlying databindings and behavior
// of the View. The ViewModel should take and return data to the Model object.
define(['knockout', 'underscore', 'jquery'],
function (ko, _, $)
{
    // Applies the application name to the DOM
    function ApplyName(app)
    {
        var titleElem = $('title');
        if (titleElem.length > 0)
        {
            titleElem.text(app.Name);
        }
        else
        {
            titleElem = $('<title>' + app.Name + '</title>');
            $('head').append(titleElem);
        }

        var nameElements = $('.AppName');
        nameElements.text(app.Name);
    }

    // Parses the DOM for data-component nodes and inserts their views
    function LoadComponents(app)
    {
        // Page Composition Algorithm:
        // -----------------------------------
        // 1. Find all data-component nodes and insert into queue (processing the DOM breadth-first)
        // 2. Take a node off the queue, parse the nodes parameters if any
        // 3. load the components stylesheet and modify it to only apply to child elements of the current components root  -- May not need the last part of this
        // 4. load the components template, *synchronously*, and expand the parameters
        // 5. insert the expanded template into the components root as html
        // 6. find the components parent, use Application if none, and add variable containers for that component
        // 7. add events and fields to the node and loaded component *
        // 8. add visibility and context databindings to the root node
        // 9. parse the components html children  for data-component nodes and add them to the queue
        // 10. When the queue is empty, the page is finished loading
        // 
        // * Events: 'activate', 'finish'  * Fields: Node, Parent, Visible(?)
        // * Ignore any nodes with a data-component of unknown name

        // Put JQuery AJAX into synchronous mode for this algorithm to work, we will clear this flag once page loading is complete
        $.ajaxSetup({ async: false });

        var componentsQueue = $('[data-component]').toArray();

        while (componentsQueue.length > 0)
        {
            var componentRoot = $(componentsQueue.pop());
            var componentName = componentRoot.data('component');

            var component = _.findWhere(app.Components, { name: componentName });
            if (component)
            {
                var params = componentRoot.data('parameters');
                if (params)
                {
                    params = JSON.parse(params);
                }


            }
        }

        // Put JQuery back into asynchronous mode for ajax requests
        $.ajaxSetup({ async: true });
    }

    var Application = {

        Model: null,

        Name: "",

        Components: [],

        // Creates the application by providing ui component information. The callback is called
        // when all view nodes have been loaded into the page
        Create: function (name, model, components, callback)
        {
            var self = this;

            self.Model = model;
            self.Name = name;
            self.Components = components;

            ApplyName(self);
            LoadComponents(self);

            // Set up each component
            var orphanedNodes = {}; // Holds nodes that have no parent until their parent is loaded
            var cnt = 0; // Holds the number of completed view loads
            _.each(components, function (comp)
            {
                // Application.ComponentName is the ViewModel class to be instantiated when the UI is shown
                self[comp.Name] = comp.ViewModel;
                self[comp.Name + '_Inst'] = ko.observable();    // Application.ComponentName_Inst is the actual instance of the ViewModel

                // Find the data-component root and set the ViewModel instance to the context and controling the visibility of the view
                var viewNode = $('[data-component="' + comp.Name + '"]');

                if (viewNode.length > 0)
                {
                    loadComponent(viewNode, comp);
                }
                else
                {
                    orphanedNodes[comp.Name] = comp;
                }
            });

            function loadComponent(viewNode, comp)
            {
                viewNode.attr('id', comp.Name);
                viewNode.attr('data-bind', 'visible: $root.' + comp.Name + '_Inst(), with: $root.' + comp.Name + '_Inst');
                viewNode.hide();    // Views are hidden by default or they will flash on the screen before knockout is fully loaded

                // If the view has a stylesheet load that too
                if ('Style' in comp)
                {
                    var styleLink = $('<link rel="stylesheet" type="text/css" href="' + comp.Style + '"/>');
                    $('head').append(styleLink);
                }

                //  Make a template node to hold the raw view before it has been processed for template replacement 
                var templateNode = $('<script type="text/template"></script>');

                // Load the view into the template node
                templateNode.load(comp.View, '', function ()
                {
                    // When the loading has been completed, perform the template expansion
                    var rawValue = templateNode.html();
                    var compiled = _.template(rawValue, comp.Parameters);

                    // Insert the compiled template into the data-component root                    
                    viewNode.html(compiled);

                    // Check the loaded view to see if it has the data-component of an orphaned viewName
                    _.each(orphanedNodes, function (comp)
                    {
                        var subView = viewNode.find('[data-component="' + comp.Name + '"]');

                        if (subView.length > 0)
                        {
                            delete orphanedNodes[comp.Name];
                            loadComponent(subView, comp);
                        }
                    });

                    // Increment the loaded view count
                    cnt++;

                    // If all the views have been loaded (since this all happens asynchronously) call the callback
                    if (cnt == components.length)
                        callback();
                });
            }
        },

        // Switches the active view
        Activate: function (viewName, params)
        {
            // Instantiate the new viewmodel, this automatically shows the associated view
            var self = this;
            self[viewName + '_Inst'](new self[viewName](params));
        },

        Finish: function (viewName, params)
        {
            // Clear the viewmodel, this automatically hides the associated view
            var self = this;
            self[viewName + '_Inst'](null);
        }
    }

    return Application;
});
