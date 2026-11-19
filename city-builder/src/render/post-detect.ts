/** Rendu logiciel (SwiftShader, llvmpipe) : jamais d'effets d'image en « auto » (mesures et tests sans GPU). */
export function isSoftwareRenderer(name: string | null): boolean {
  return !!name && /SwiftShader|llvmpipe|softpipe|Software/i.test(name);
}
