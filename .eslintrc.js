module.exports = {
  env: {
    browser: true,
    commonjs: true,
    es6: true,
    node: true,
  },
  extends: ["eslint:recommended", "plugin:jsdoc/recommended"],
  parserOptions: {
    ecmaVersion: 2020,
  },
  plugins: ["react", "jsdoc"],
  rules: {
    indent: ["error", 2, { SwitchCase: 1 }],
    "linebreak-style": ["error", "unix"],
    "no-var": ["error"],
    "prefer-const": ["error"],
    quotes: ["error", "double", { avoidEscape: true }],
    semi: ["error", "never"],
  },
  globals: {
    artifacts: false,
    contract: false,
    assert: false,
    web3: false,
  },
}
