// Avisos (webhooks) de Operam con su forma REAL (#510), medida en
// operam_webhooks_log de produccion el 2026-10-02 (#506): llaves, tipos y los
// valores de los identificadores son los del log. Lo que no se leyo -- el texto de
// `description` y la llave del objeto `trans_no` del pedido -- va marcado; el
// codigo no lee ninguno de los dos.

// Pedido: la fila id=2 del log (2026-06-17), pedido de la cotizacion 1141.
export function avisoPedido({ reference = '2606741', transNoFrom = '1141', customerId = '394' } = {}) {
  return {
    type: 'ADD',
    model: 'Order',
    description: 'Order', // texto no leido
    data: {
      order_no: null,
      trans_no: { 0: 0 }, // objeto de UNA llave en el log; su contenido no se leyo
      trans_type: '30',
      reference,
      customer_id: customerId,
      trans_no_from: transNoFrom,
      customer_name: 'CLIENTE',
      document_date: '2026-06-17',
      line_items: [],
      src_docs: [],
      voided: null,
    },
  };
}

// Pago: la fila id=828 del log (2026-09-30). `order_` llega en "0".
export function avisoPago({ transNo = '7695', debtorNo = '537', taxId = 'XAXX010101000' } = {}) {
  return {
    type: 'ADD',
    model: 'Payment',
    description: 'Payment', // texto no leido
    data: {
      0: transNo,
      type: '12',
      trans_no: transNo,
      version: '0',
      debtor_no: debtorNo,
      tax_id: taxId,
      order_: '0',
      reference: '6254.',
      tran_date: '2026-09-30',
      branch_code: '589',
      Total: '1000.00',
      alloc: '0',
    },
  };
}

// Remision: la fila id=12 del log (2026-06-19). `data` es solo un numero.
export function avisoRemision(numero = 2400) {
  return {
    type: 'ADD',
    model: 'CustDelivery',
    description: 'CustDelivery', // texto no leido
    data: numero,
  };
}
