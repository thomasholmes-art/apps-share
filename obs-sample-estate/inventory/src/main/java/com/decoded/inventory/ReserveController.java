// inventory: the HTTP routes (obs-sample-estate, all stages).
//
//   POST /reserve   body {"currency":"GBP","lines":[{"sku":...,"qty":n}]},
//                   exactly what checkout-api's reserveStock sends; always 200
//   GET /healthz    200 "ok"
package com.decoded.inventory;

import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class ReserveController {
    private final StockService stock;

    public ReserveController(StockService stock) {
        this.stock = stock;
    }

    @PostMapping(path = "/reserve", produces = MediaType.APPLICATION_JSON_VALUE)
    public StockService.Reply reserve(@RequestBody StockService.Basket basket) {
        return stock.reserve(basket);
    }

    @GetMapping(path = "/healthz", produces = MediaType.TEXT_PLAIN_VALUE)
    public String healthz() {
        return "ok";
    }
}
