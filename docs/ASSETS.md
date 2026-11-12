# 3D visuals and model packs

The standard source release includes 86 GLBs in `packages/assets/models/` and a role index in `packages/assets/manifest.json`. Keep those paths together in the source tree. A clone of the release already contains the pack. The renderer displays the opening view once its models are ready and uses built-in geometry for missing or invalid models.

## Generate a personal model

The bundled models load without a Tripo key. For personal models, add your own Tripo API key in **Settings** and select **Generate overlay** on an available offer. That request uses your Tripo account. Keep the key in your local settings or environment. [Privacy and network activity](PRIVACY.md)

## Use your own local pack

Set `KODYURD_MODEL_PACK` to a directory you control before starting Kodyurd. For each role, place a self-contained GLB at `models/<role>.glb` and list the role in `manifest.json`. For example:

~~~json
{
  "schemaVersion": 1,
  "assets": [
    { "role": "building-hall" },
    { "role": "icon-database" }
  ]
}
~~~

Use a consistent scale and orientation. The viewer fits each model to its mount. Keep a copy of the model's license and source. **Export bundle** includes the models used in the city, so review your rights before sharing the ZIP.

The MIT source license and bundled asset terms are documented separately. [Bundled model notice](../packages/assets/README.md)
