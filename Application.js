// Application class
// Requries a datamodel in the "Model" module
// Manages switching ui components which are views and associated viewmodels
// Views are HTML partial pages, ViewModels are the underlying databindings and behavior
// of the View. The ViewModel should take and return data to the Model object.
define(['knockout', 'underscore', 'jquery'], function (ko, _, $)
{
    var Application = {
    
        // Creates the application by providing ui component information. The callback is called
        // when all view nodes have been loaded into the page
        Create: function (name, model, components, callback)
        {
            var self = this;
            
            self.Model = model;
            
            self.Name = name;
                       
            var titleElem = $('title');
            if(titleElem.length > 0)
            {
                titleElem.text(name);
            }
            else
            {
                titleElem = $('<title>' + name + '</title>');
                $('head').append(titleElem);
            }
            
            var nameElements = $('.AppName');
            nameElements.text(name);

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
                
                if(viewNode.length > 0)
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
                if('Style' in comp)
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
                    _.each(orphanedNodes, function(comp)
                    {
                        var subView = viewNode.find('[data-component="' + comp.Name + '"]');
                        
                        if(subView.length > 0)
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
        
        Finish: function(viewName, params)
        {
            // Clear the viewmodel, this automatically hides the associated view
            var self = this;
            self[viewName + '_Inst'](null);
        }
    }

    return Application;
});
