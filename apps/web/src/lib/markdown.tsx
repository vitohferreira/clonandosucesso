import type { ReactNode } from 'react';

/**
 * Renderizador de markdown mínimo.
 *
 * A síntese vem do modelo em markdown simples — títulos, parágrafos, listas e
 * negrito. Cobrir só isso evita uma dependência inteira para o pouco que se usa.
 */
function comNegrito(texto: string, chave: string): ReactNode[] {
  return texto.split(/(\*\*[^*]+\*\*)/g).map((parte, i) =>
    parte.startsWith('**') && parte.endsWith('**') ? (
      <strong key={`${chave}-${i}`} className="font-semibold text-ink">
        {parte.slice(2, -2)}
      </strong>
    ) : (
      <span key={`${chave}-${i}`}>{parte}</span>
    ),
  );
}

export function Markdown({ texto }: { texto: string }) {
  const linhas = texto.split('\n');
  const saida: ReactNode[] = [];
  let lista: string[] = [];

  const fecharLista = (chave: string) => {
    if (lista.length === 0) return;
    saida.push(
      <ul key={`ul-${chave}`} className="my-3 space-y-1.5 pl-4">
        {lista.map((item, i) => (
          <li key={i} className="relative text-[14px] leading-relaxed text-ink-dim">
            <span className="absolute -left-4 text-signal">·</span>
            {comNegrito(item, `li-${chave}-${i}`)}
          </li>
        ))}
      </ul>,
    );
    lista = [];
  };

  linhas.forEach((linha, i) => {
    const corte = linha.trim();

    if (corte.startsWith('- ') || corte.startsWith('* ')) {
      lista.push(corte.slice(2));
      return;
    }

    fecharLista(String(i));

    if (!corte) return;

    if (corte.startsWith('### ')) {
      saida.push(
        <h3 key={i} className="mt-6 mb-2 font-display text-[15px] font-semibold">
          {corte.slice(4)}
        </h3>,
      );
    } else if (corte.startsWith('## ')) {
      saida.push(
        <h2 key={i} className="mt-7 mb-2.5 font-display text-[17px] font-semibold">
          {corte.slice(3)}
        </h2>,
      );
    } else if (corte.startsWith('# ')) {
      saida.push(
        <h2 key={i} className="mt-7 mb-2.5 font-display text-[18px] font-semibold">
          {corte.slice(2)}
        </h2>,
      );
    } else {
      saida.push(
        <p key={i} className="my-3 text-[14px] leading-relaxed text-ink-dim">
          {comNegrito(corte, `p-${i}`)}
        </p>,
      );
    }
  });

  fecharLista('fim');
  return <div>{saida}</div>;
}
