/**
 * Main JavaScript for danielmherman.com
 * Handles: Mermaid diagrams, Prism syntax highlighting, Table of Contents
 */

document.addEventListener('DOMContentLoaded', function() {
    // Initialize Mermaid with GitHub-like light theme
    mermaid.initialize({
        startOnLoad: false,
        theme: 'default',
        securityLevel: 'loose',
        flowchart: { 
            htmlLabels: true,
            curve: 'basis'
        },
        themeVariables: {
            primaryColor: '#dce5f2',
            primaryTextColor: '#24292f',
            primaryBorderColor: '#8b949e',
            lineColor: '#57606a',
            secondaryColor: '#fff8dc',
            tertiaryColor: '#f6f8fa',
            background: '#ffffff'
        }
    });

    // Find all pre elements in article content
    document.querySelectorAll('.article-content pre').forEach(function(pre) {
        // Get innerHTML to preserve structure
        var rawContent = pre.innerHTML;
        
        // Convert paragraph and line break tags to newlines
        var content = rawContent
            .replace(/<\/p>\s*<p[^>]*>/gi, '\n')  // </p><p> to newline
            .replace(/<p[^>]*>/gi, '')             // Remove opening <p> tags
            .replace(/<\/p>/gi, '\n')              // </p> to newline
            .replace(/<br\s*\/?>/gi, '\n')         // <br> to newline
            .replace(/<[^>]+>/g, '')               // Remove any other HTML tags
            .replace(/&nbsp;/gi, ' ')              // Non-breaking space to space
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/\n\s*\n\s*\n/g, '\n\n')     // Collapse multiple blank lines
            .trim();
        
        // Check if this is a Mermaid diagram (starts with mermaid keywords)
        var mermaidKeywords = ['graph ', 'graph\n', 'flowchart ', 'flowchart\n', 
                               'sequenceDiagram', 'classDiagram', 
                               'stateDiagram', 'erDiagram', 'gantt', 'pie ', 
                               'pie\n', 'journey', 'gitGraph', 'mindmap', 
                               'timeline', 'quadrantChart'];
        var isMermaid = mermaidKeywords.some(function(keyword) {
            return content.toLowerCase().startsWith(keyword.toLowerCase());
        });
        
        if (isMermaid) {
            // Create container with controls like GitHub
            var container = document.createElement('div');
            container.className = 'mermaid-container';
            
            // Create Mermaid div
            var mermaidDiv = document.createElement('div');
            mermaidDiv.className = 'mermaid';
            mermaidDiv.textContent = content;
            
            // Create controls
            var controls = document.createElement('div');
            controls.className = 'mermaid-controls';
            controls.innerHTML = `
                <button title="Zoom in" onclick="this.closest('.mermaid-container').querySelector('svg').style.transform = 'scale(' + (parseFloat(this.closest('.mermaid-container').querySelector('svg').style.transform.replace('scale(','').replace(')','') || 1) + 0.2) + ')'">
                    <i class="fas fa-search-plus"></i>
                </button>
                <button title="Zoom out" onclick="this.closest('.mermaid-container').querySelector('svg').style.transform = 'scale(' + Math.max(0.2, (parseFloat(this.closest('.mermaid-container').querySelector('svg').style.transform.replace('scale(','').replace(')','') || 1) - 0.2)) + ')'">
                    <i class="fas fa-search-minus"></i>
                </button>
                <div class="divider"></div>
                <button title="Reset zoom" onclick="this.closest('.mermaid-container').querySelector('svg').style.transform = 'scale(1)'">
                    <i class="fas fa-sync-alt"></i>
                </button>
            `;
            
            container.appendChild(controls);
            container.appendChild(mermaidDiv);
            pre.replaceWith(container);
            return;
        }
        
        // Skip if already has a code child with language class
        if (pre.querySelector('code[class*="language-"]')) return;
        
        // Create code element with Python as default language
        var code = document.createElement('code');
        code.className = 'language-python';
        code.textContent = pre.textContent;
        
        // Clear pre and add code element
        pre.innerHTML = '';
        pre.appendChild(code);
        
        // Run Prism highlighting
        Prism.highlightElement(code);
    });
    
    // Render all Mermaid diagrams with error handling
    document.querySelectorAll('.mermaid').forEach(async function(el, index) {
        try {
            var id = 'mermaid-' + index;
            var result = await mermaid.render(id, el.textContent);
            el.innerHTML = result.svg;
        } catch (error) {
            console.error('Mermaid error:', error);
            console.error('Diagram content:', el.textContent);
            el.innerHTML = '<pre style="color: red;">Mermaid Error: ' + (error.message || JSON.stringify(error)) + '</pre>';
        }
    });

    // Auto-generate Table of Contents from [TOC] placeholder
    document.querySelectorAll('.article-content').forEach(function(content) {
        // Find [TOC] placeholder (can be in a <p> tag or standalone)
        var tocPlaceholder = null;
        var walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, null, false);
        while (walker.nextNode()) {
            if (walker.currentNode.textContent.trim() === '[TOC]') {
                tocPlaceholder = walker.currentNode;
                break;
            }
        }
        
        if (!tocPlaceholder) return;
        
        // Find all headings (h2, h3, h4) in the content
        var headings = content.querySelectorAll('h2, h3, h4');
        if (headings.length === 0) return;
        
        // Build TOC
        var tocHtml = '<nav class="toc"><h4 class="toc-title">Table of Contents</h4><ul class="toc-list">';
        
        headings.forEach(function(heading, index) {
            // Generate ID from heading text
            var text = heading.textContent.trim();
            var id = text.toLowerCase()
                .replace(/[^a-z0-9\s-]/g, '')  // Remove special chars
                .replace(/\s+/g, '-')           // Spaces to hyphens
                .replace(/-+/g, '-')            // Collapse multiple hyphens
                .substring(0, 50);              // Limit length
            
            // Ensure unique ID
            if (!id) id = 'section-' + index;
            if (document.getElementById(id)) id = id + '-' + index;
            
            // Add ID to heading
            heading.id = id;
            
            // Determine indent level
            var level = parseInt(heading.tagName.charAt(1)) - 2;  // h2=0, h3=1, h4=2
            var indent = level > 0 ? ' style="margin-left: ' + (level * 1.25) + 'rem;"' : '';
            
            tocHtml += '<li' + indent + '><a href="#' + id + '">' + text + '</a></li>';
        });
        
        tocHtml += '</ul></nav>';
        
        // Replace placeholder with TOC
        var tocElement = document.createElement('div');
        tocElement.innerHTML = tocHtml;
        
        // Handle if placeholder is inside a <p> tag
        var parent = tocPlaceholder.parentNode;
        if (parent.tagName === 'P' && parent.textContent.trim() === '[TOC]') {
            parent.replaceWith(tocElement.firstChild);
        } else {
            tocPlaceholder.replaceWith(tocElement.firstChild);
        }
    });
});
