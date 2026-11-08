"""The map that translates an answer's page numbers back into array positions.

The answer column stores the prose a reader saw, and settlement compacts its `^[n]`
markers to `1..K` per turn. The evidence array keeps its own cumulative numbering, so a
stored answer can only be replayed faithfully when this map travels with it. Without it
`graph.replay_messages` deletes every marker from the earlier turns, and a follow-up is
written against a transcript in which nothing was ever cited.

Empty for every turn stored before this migration, which is the same statement as "this
answer cites nothing" and replays exactly as it did.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('demo', '0010_remove_conversation_title'),
    ]

    operations = [
        migrations.AddField(
            model_name='turn',
            name='citation_map',
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
