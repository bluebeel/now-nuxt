# now-nuxt

A Now v2 Nuxt builder.

## Usage

Add it to your `now.json` as:

```json
{
  "builds": [
    { "src": "nuxt.config.js", "use": "@bluebeel/nuxt" }
  ]
}
```
You have to modify your nuxt.config.js file and customize the build property
```javascript
build:  {
      filenames: {
        app: '[name].js',
        chunk: '[name].js'
      }
}
```

And don't forget to change the way the configuration is returned.
The default nuxt.config.js is
```javascript
export default {
  ...
}
```
Change it to
```javascript
module.exports = () => {
  return { ... }
}
```

## Example
Simple:
https://nuxtjs-v2.now.sh/

[Repository](https://github.com/bluebeel/now-nuxt-example) of the example.

Hackernews:
https://nuxtjs-news-v2.now.sh

[Repository](https://github.com/bluebeel/hackernews) of the example.
