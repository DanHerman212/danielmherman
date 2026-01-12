# Personal Website & Portfolio

A Django-based content management system and portfolio website.

## Software Architecture

The application follows the standard Django MVT (Model-View-Template) architecture. Below is a high-level overview of the data flow and system components:

```mermaid
graph TD
    Client["User / Web Browser"]
    
    subgraph "Django Application"
        Router["URL Dispatcher<br/>(urls.py)"]
        
        subgraph "Content App"
            Views["Views Logic<br/>(views.py)"]
            Models["Data Models<br/>(models.py)"]
            Templates["Templates<br/>(HTML/Tags)"]
        end
        
        Admin["Django Admin"]
    end
    
    Database[("SQLite3 DB")]
    Static["Static Assets<br/>(CSS/Images)"]
    
    %% Flow
    Client -->|HTTP GET/POST| Router
    Router --> Views
    
    Views -->|Query Data| Models
    Models <-->|ORM| Database
    
    Views -->|Context| Templates
    Templates -->|HTML Response| Client
    
    Admin -->|Manage| Models
    
    %% Static link
    Client -.->|Load| Static
```

### Core Components
*   **Models**: Defines structure for `Articles`, `Projects`, `Categories`, and `ContactMessages`.
*   **Views**: Class-based views (CBVs) handling logic for lists, details, and form submissions.
*   **Templates**: Responsive Bootstrap 5 layouts for presentation.
*   **Services**: 
    *   **CKEditor**: For rich text content creation.
    *   **SQLite**: Lightweight database for development.
