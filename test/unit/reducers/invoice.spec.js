import snapshotDiff from '../__helpers__/snapshotDiff'
import reducer, {
  SET_INVOICE,
  GET_INVOICES,
  RECEIVE_INVOICES,
  ADD_INVOICE,
  INVOICE_SUCCESSFUL,
  INVOICE_FAILED,
  UPDATE_INVOICE,
} from 'reducers/invoice'

describe('reducers', () => {
  describe('invoiceReducer', () => {
    it('should handle initial state', () => {
      expect(reducer(undefined, {})).toMatchSnapshot()
    })

    it('should handle SET_INVOICE', () => {
      const action = {
        type: SET_INVOICE,
        invoice: { rHash: '123' },
      }
      expect(snapshotDiff(reducer(undefined, {}), reducer(undefined, action))).toMatchSnapshot()
    })

    it('should handle GET_INVOICES', () => {
      const action = {
        type: GET_INVOICES,
      }
      expect(snapshotDiff(reducer(undefined, {}), reducer(undefined, action))).toMatchSnapshot()
    })

    it('should handle RECEIVE_INVOICES', () => {
      const action = {
        type: RECEIVE_INVOICES,
        invoices: [
          { rHash: '123', addIndex: 1 },
          { rHash: '456', addIndex: 2 },
        ],
      }
      expect(snapshotDiff(reducer(undefined, {}), reducer(undefined, action))).toMatchSnapshot()
    })

    it('should handle ADD_INVOICE', () => {
      const action = {
        type: ADD_INVOICE,
      }
      expect(snapshotDiff(reducer(undefined, {}), reducer(undefined, action))).toMatchSnapshot()
    })

    it('should handle INVOICE_SUCCESSFUL', () => {
      const action = {
        type: INVOICE_SUCCESSFUL,
      }
      expect(snapshotDiff(reducer(undefined, {}), reducer(undefined, action))).toMatchSnapshot()
    })

    it('should handle INVOICE_FAILED', () => {
      const action = {
        type: INVOICE_FAILED,
        error: 'some error',
      }
      expect(snapshotDiff(reducer(undefined, {}), reducer(undefined, action))).toMatchSnapshot()
    })

    it('should handle UPDATE_INVOICE', () => {
      const action = {
        type: UPDATE_INVOICE,
        invoice: {
          rHash: '123',
        },
      }
      expect(snapshotDiff(reducer(undefined, {}), reducer(undefined, action))).toMatchSnapshot()
    })
  })
})
