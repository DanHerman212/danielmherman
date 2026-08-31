from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('demo', '0002_demoquota'),
    ]

    operations = [
        migrations.AddField(
            model_name='demoquota',
            name='refunds',
            field=models.PositiveSmallIntegerField(default=0),
        ),
    ]
