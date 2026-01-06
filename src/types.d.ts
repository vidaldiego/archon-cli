// Path: archon-cli/src/types.d.ts
// Type declarations for modules without types

declare module 'inquirer' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function prompt<T = any>(questions: any[]): Promise<T>;

  const inquirer: {
    prompt: typeof prompt;
  };

  export default inquirer;
}
