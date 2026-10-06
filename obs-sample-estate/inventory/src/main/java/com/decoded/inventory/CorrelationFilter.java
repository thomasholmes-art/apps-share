// inventory: the correlation-id request filter (obs-sample-estate, all
// stages; module 02's Java mechanism, lab 02's second hop).
//
// Reads `x-correlation-id` into the logging MDC as `correlation_id`, or
// creates a UUID when the request carries none, and clears the MDC when the
// request ends so a pooled thread never carries one customer's id into the
// next request. Background jobs run outside this filter and log `cid=-`.
// The filter also writes the `http.request` access event for GET /healthz;
// POST /reserve gets no access line, so lab 02's Q2 counts seven records.
package com.decoded.inventory;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class CorrelationFilter extends OncePerRequestFilter {
    static final String HEADER = "x-correlation-id";
    private static final Logger log = LoggerFactory.getLogger(ReserveController.class);

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String inbound = request.getHeader(HEADER);
        String id = (inbound == null || inbound.isBlank()) ? UUID.randomUUID().toString() : inbound;
        long started = System.nanoTime();
        MDC.put("correlation_id", id);
        try {
            chain.doFilter(request, response);
            if ("/healthz".equals(request.getRequestURI())) {
                log.info(Events.line("http.request", "request served",
                        "method", request.getMethod(), "route", "/healthz", "status", response.getStatus(),
                        "bytes", 2, "duration_ms", Math.max(1, (System.nanoTime() - started) / 1_000_000)));
            }
        } finally {
            MDC.remove("correlation_id");
        }
    }
}
