module.exports = {
  overrides: [
    {
      files: "*.sol",
      options: {
        printWidth: 129,
        tabWidth: 4,
        useTabs: false,
        singleQuote: false,
        bracketSpacing: false,
        explicitTypes: "always",
      },
    },
    {
      files: "*.js",
      options: {
        semi: false,
        printWidth: 129,
        bracketSpacing: true,
        trailingComma: "es5",
      },
    },
  ],
}
