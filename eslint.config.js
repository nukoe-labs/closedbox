import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  { ignores: ["dist", "coverage"] },
  { files: ["scripts/**/*.mjs"], languageOptions: { globals: globals.node } },
  eslint.configs.recommended,
  ...tseslint.configs.strict,
  {
    rules: {
      curly: ["error", "all"],
      "no-nested-ternary": "error",
      "no-else-return": "error",
      "max-params": ["error", 4],
      "max-depth": ["error", 2],
      "no-restricted-syntax": [
        "error",
        { selector: "ArrowFunctionExpression", message: "Use a named function." },
        { selector: ":not(MethodDefinition) > FunctionExpression[id=null]", message: "Use a named function." },
      ],
    },
  },
);
