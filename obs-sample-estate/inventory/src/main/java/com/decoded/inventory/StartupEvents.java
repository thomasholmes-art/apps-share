// inventory: start-up events (obs-sample-estate, all stages; the first
// inventory records in lab 02's reference export).
package com.decoded.inventory;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

@Component
public class StartupEvents {
    private static final Logger log = LoggerFactory.getLogger(InventoryApplication.class);
    private final Environment env;

    public StartupEvents(Environment env) {
        this.env = env;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void ready() {
        log.info(Events.line("config.loaded", "configuration loaded", "source", "env", "log_level", "info"));
        log.info(Events.line("service.started", "inventory listening", "port", env.getProperty("server.port")));
    }
}
