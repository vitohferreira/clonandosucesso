/**
 * A marca do Molde.
 *
 * Uma grade 3x3 com uma celula acesa. E literalmente o produto: um perfil e uma
 * grade de posts, e o que interessa e a celula que se destaca das outras.
 */
export function LogoMark({ size = 22 }: { size?: number }) {
  const cell = 5;
  const gap = 2.5;
  const posicoes = [0, 1, 2];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 22.5 22.5"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      {posicoes.map((linha) =>
        posicoes.map((coluna) => {
          const destaque = linha === 1 && coluna === 2;
          return (
            <rect
              key={`${linha}-${coluna}`}
              x={coluna * (cell + gap)}
              y={linha * (cell + gap)}
              width={cell}
              height={cell}
              rx={1}
              fill={destaque ? 'var(--color-signal)' : 'var(--color-line-bright)'}
            />
          );
        }),
      )}
    </svg>
  );
}

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark size={size} />
      <span className="font-display text-[15px] font-semibold tracking-tight">Molde</span>
    </span>
  );
}
