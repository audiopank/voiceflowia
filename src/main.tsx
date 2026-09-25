import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider, createRouter, parseSearchWith, stringifySearchWith } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import '@/app.css'

const router = createRouter({
  routeTree,
  // Query string PLANA (25/09): o serializador padrão do TanStack cita strings ao
  // reescrever a URL — "/cadastro?trial=1" virava "?trial=%221%22" na barra e o link
  // copiado pra divulgação saía com aspas. Sem parser, string sai como texto puro.
  // Atenção: na LEITURA o decode ainda converte "1" → 1 e "true" → true (qss),
  // por isso /cadastro e /kit-whatsapp normalizam com String() no validateSearch.
  parseSearch: parseSearchWith((valor) => valor),
  stringifySearch: stringifySearchWith(JSON.stringify),
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
)
