# Content management system — the personal site

The publishing half of the project: long-form writing, a project portfolio, and a public
inbox, all authored in the Django admin. It follows the ordinary Django model–view–template
shape — models define the content, class-based views select and shape it, templates present
it — and needs no service beyond the database and media storage.

## Capabilities

| Capability | What it does |
|---|---|
| Articles | Long-form writing, organised into the site's sections and reachable at a stable address. |
| Categories | The main menu — tech, music, enlightenment, resume, projects, contact — ordered by hand and hideable without being deleted. |
| Projects | Portfolio entries with a description, links to a live demo and its source, and the technologies used. |
| Contact | A public form whose messages land in an admin inbox rather than an email account. |
| Authoring | Rich text in CKEditor 5, with images uploaded to media storage rather than served from the container. |
| Slugs | Derived from the title on first save and de-duplicated, so two articles sharing a title cannot collide. |
| Publishing | Per-item publish and active flags. Nothing is public until it is switched on. |
| Ordering | Manual ordering for categories and projects, so curation is not left to dates. |
| Administration | Django admin for every model above. |
| Presentation | Responsive templates sharing one base layout, with static assets served by the application. |

## Where the content lives

Postgres in production and SQLite in development, behind the same ORM: local development needs
no cloud credentials, and nothing in the templates knows the difference. Uploaded media goes to
object storage in production, so a redeploy never discards it.

See [`../architecture/README.md`](../architecture/README.md) for the deployment this runs on.
