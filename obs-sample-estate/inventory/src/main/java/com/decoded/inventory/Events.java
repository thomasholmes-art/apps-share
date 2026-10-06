// inventory: the event line format (obs-sample-estate, all stages; parsed by
// the host log collector for labs 02 to 06).
//
// Every event is one log message of the form
//   event=inventory.reserve_requested lines=3 msg="reservation requested"
// The console pattern adds the timestamp, level, thread and `cid=`; the host
// collector's regex and key=value parsers turn the line into the attributes
// `event`, `lines`, `msg`, `correlation_id`, `level` and `service_name`, the
// same names checkout-api's JSON records use.
package com.decoded.inventory;

import java.util.LinkedHashMap;
import java.util.Map;

final class Events {
    private Events() {
    }

    static String line(String event, String msg, Object... keyValues) {
        Map<String, Object> fields = new LinkedHashMap<>();
        for (int i = 0; i + 1 < keyValues.length; i += 2) {
            fields.put(String.valueOf(keyValues[i]), keyValues[i + 1]);
        }
        StringBuilder out = new StringBuilder("event=").append(event);
        fields.forEach((k, v) -> out.append(' ').append(k).append('=').append(v));
        return out.append(" msg=\"").append(msg.replace("\"", "'")).append('"').toString();
    }
}
