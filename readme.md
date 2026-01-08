```mermaid
graph TD
    User((User / Browser))

    subgraph "Django Project: danielmherman"
        WSGI["wsgi.py / asgi.py<br/>(Entry Point)"]
        Settings["settings.py<br/>(Configuration)"]
        MainURLs["urls.py<br/>(Main Routing)"]
    end

    subgraph "Django App: content"
        AppURLs["urls.py<br/>(App Routing)"]
        Views["views.py<br/>(View Logic)"]
        Models["models.py<br/>(Data Models)"]
        Admin["admin.py<br/>(Admin Interface)"]
        
        subgraph "Presentation Layer"
            Templates["Templates<br/>(HTML)"]
            Static["Static Files<br/>(CSS, JS)"]
            Media["Media Files<br/>(User Uploads)"]
        end
    end

    Database[("SQLite Database<br/>db.sqlite3")]

    %% Request Flow
    User -- "HTTP Request" --> WSGI
    WSGI --> MainURLs
    MainURLs -- "include('content.urls')" --> AppURLs
    AppURLs -- "Routes to" --> Views

    %% Logic & Data Flow
    Views -- "Read/Write" --> Models
    Models <-->|ORM| Database
    Admin -- "Manage" --> Models

    %% Response Flow
    Views -- "Render Context" --> Templates
    Templates -.-> Static : "References"
    Templates -.-> Media : "References"
    Templates -- "HTML Response" --> User

    %% Configuration dependency
    Settings -.->|Configures| MainURLs
    Settings -.->|Configures| Database
    Settings -.->|Configures| Static
```