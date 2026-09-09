// components/decorative-illustration.tsx imports .webp files directly so Next reads their real
// dimensions from the bytes. This reference declares those file modules to TypeScript. The
// generated next-env.d.ts carries the same line, but it is git-ignored, so `npm run typecheck` on a
// fresh clone would not see it.
/// <reference types="next/image-types/global" />
