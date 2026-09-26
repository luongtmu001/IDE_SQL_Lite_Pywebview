# PostgreSQL Event Listener — Bravo Backend Integration

## 1. Mục đích

Xây dựng chức năng **lắng nghe các sự kiện tác động đến PostgreSQL Database** trong môi trường đặc thù của BRAVO.

Hệ thống BRAVO có thể sử dụng:

- PostgreSQL.
- BRAVO Backend chạy trên máy chủ.
- WinForms Client.
- Elasticsearch.
- Redis.
- Access Token cho Backend.
- Một hoặc nhiều Backend tùy mô hình triển khai.

Chức năng này phải cho phép IDE kết nối đến hệ thống BRAVO và theo dõi các sự kiện liên quan đến PostgreSQL.

Mục tiêu:

```text
PostgreSQL
    ↓
Database Event
    ↓
Event Listener
    ↓
IDE
    ↓
Event Stream / Event Log
```

---

# 2. Phạm vi

Chức năng phải hỗ trợ 3 phương thức kết nối:

```text
Method 1
Chọn Backend đang được cài đặt trên máy chủ BRAVO

Method 2
Kết nối từ xa thông qua thông tin Backend

Method 3
Kết nối trực tiếp tới PostgreSQL thông qua cùng mạng
```

Method 2 phải hỗ trợ hai mô hình:

```text
2.1 Một Backend

IDE
 ↓
BRAVO Backend
 ↓
PostgreSQL

Thông tin:
IP
Port
Access Token
```

và:

```text
2.2 Hai Backend

IDE
 ↓
Backend 1
 ↓
Backend 2 / Redis
 ↓
PostgreSQL Event Infrastructure
```

Thông tin Redis phải được cấu hình riêng.

---

# 3. Kiến trúc tổng thể

Không được để UI phụ thuộc trực tiếp vào từng phương thức kết nối.

Kiến trúc:

```text
                    ┌──────────────────────┐
                    │      Event UI        │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │ Event Listener Core  │
                    └──────────┬───────────┘
                               │
                    ┌──────────▼───────────┐
                    │ Event Source Adapter │
                    └──────────┬───────────┘
                               │
          ┌────────────────────┼─────────────────────┐
          │                    │                     │
          ▼                    ▼                     ▼
   Backend Adapter      Redis Adapter        PostgreSQL Adapter
          │                    │                     │
          ▼                    ▼                     ▼
      BRAVO API             Redis             PostgreSQL
```

UI chỉ làm việc với một Event Model thống nhất.

---

# 4. Event Model

Mọi nguồn sự kiện phải được chuyển thành một cấu trúc thống nhất.

Ví dụ:

```json
{
    "event_id": "uuid",
    "source": "postgresql",
    "database": "BravoDB",
    "schema": "public",
    "table": "B20Customer",
    "operation": "UPDATE",
    "timestamp": "2026-09-25T01:30:00+07:00",
    "transaction_id": 123456,
    "source_type": "backend",
    "payload": {},
    "metadata": {}
}
```

Các operation có thể gồm:

```text
INSERT
UPDATE
DELETE
DDL
TRUNCATE
UNKNOWN
```

Không được giả định rằng tất cả event đều có đầy đủ:

- Table.
- Row.
- Old Value.
- New Value.
- User.
- Transaction ID.

Nếu nguồn không cung cấp thông tin đó thì để `null`.

---

# 5. Phân biệt Database Event và Application Event

Đây là quy tắc quan trọng.

Không được gọi mọi message từ Backend hoặc Redis là:

```text
PostgreSQL Database Event
```

Phải phân biệt:

```text
DATABASE_EVENT
APPLICATION_EVENT
BACKEND_EVENT
REDIS_EVENT
SYSTEM_EVENT
```

Ví dụ:

```text
PostgreSQL:
UPDATE Customer
```

là:

```text
DATABASE_EVENT
```

Trong khi:

```text
Backend:
CustomerChanged
```

có thể là:

```text
APPLICATION_EVENT
```

Nếu Backend phát event sau khi PostgreSQL commit, có thể liên kết hai event nhưng không được mặc định coi chúng là cùng một event.

---

# 6. Connection Method

UI phải cho phép người dùng chọn:

```text
┌──────────────────────────────────────────┐
│ PostgreSQL Event Listener                │
├──────────────────────────────────────────┤
│ Connection Method                         │
│                                          │
│ ○ Local BRAVO Backend                    │
│ ○ Remote BRAVO Backend                   │
│ ○ Direct PostgreSQL                      │
└──────────────────────────────────────────┘
```

Khi chọn từng phương thức, UI hiển thị đúng các trường cần thiết.

---

# 7. Method 1 — Chọn Backend tại máy chủ BRAVO

## Mục đích

Cho phép IDE chạy hoặc được sử dụng trực tiếp trên máy chủ đã cài đặt BRAVO Backend.

Người dùng không cần nhập thủ công:

```text
IP
Port
Access Token
Redis
```

nếu Backend có thể được phát hiện từ môi trường cài đặt.

---

## 7.1. Backend Discovery

Hệ thống phải có cơ chế phát hiện Backend.

Có thể dựa trên:

```text
Installed Service
Windows Service
Configuration File
Environment Variable
Local Configuration
Known Backend Port
```

Không được hard-code một đường dẫn hoặc port duy nhất.

---

## 7.2. Backend List

Nếu máy chủ có nhiều Backend:

```text
┌──────────────────────────────────────────────┐
│ Available BRAVO Backends                     │
├──────────────────────────────────────────────┤
│ ○ Backend A                                  │
│   Port: 8001                                 │
│   Status: Running                            │
│                                              │
│ ○ Backend B                                  │
│   Port: 8002                                 │
│   Status: Running                            │
└──────────────────────────────────────────────┘
```

Người dùng chọn Backend cần sử dụng.

---

## 7.3. Kiểm tra Backend

Sau khi chọn:

```text
Discover
   ↓
Connect
   ↓
Authenticate
   ↓
Get Backend Metadata
   ↓
Check Event Capability
```

Nếu Backend không hỗ trợ event listener:

```text
Backend does not expose database event listening capability.
```

Không được giả định Backend nào cũng hỗ trợ.

---

# 8. Method 2 — Remote BRAVO Backend

Phương thức này dùng khi IDE không chạy trên cùng máy chủ BRAVO.

UI:

```text
┌──────────────────────────────────────────────┐
│ Remote BRAVO Backend                         │
├──────────────────────────────────────────────┤
│ IP / Host                                    │
│ [ 10.10.10.100                         ]     │
│                                              │
│ Port                                         │
│ [ 8001                                  ]     │
│                                              │
│ Access Token                                 │
│ [ ************************************** ]    │
│                                              │
│ [ Test Connection ]                          │
└──────────────────────────────────────────────┘
```

---

# 9. Remote Backend Authentication

Backend connection phải sử dụng:

```text
IP / Host
Port
Access Token
```

Access Token phải được xử lý như credential nhạy cảm.

Không được:

- Log token.
- Hiển thị token đầy đủ sau khi nhập.
- Ghi token vào event log.
- Ghi token vào SQL log.
- Đưa token vào URL nếu Backend không yêu cầu.
- Commit token vào source code.

---

# 10. Test Connection

Phải có bước:

```text
Test Connection
```

Workflow:

```text
Input
 ↓
Validate Host
 ↓
Validate Port
 ↓
Connect
 ↓
Authenticate
 ↓
Check Backend
 ↓
Check Event Capability
```

Kết quả:

```text
✓ Backend reachable
✓ Authentication successful
✓ Event listener supported
✓ PostgreSQL event source available
```

hoặc:

```text
✗ Authentication failed
```

---

# 11. Method 2.2 — Two Backend + Redis

Một số hệ thống BRAVO có thể sử dụng mô hình:

```text
IDE
 │
 ▼
Backend 1
 │
 ▼
Backend 2 / Event Service
 │
 ▼
Redis
 │
 ▼
PostgreSQL / Event Pipeline
```

Trong trường hợp này phải cho phép cấu hình Redis.

---

# 12. Redis Connection

Thông tin Redis phải được cấu hình riêng.

Ví dụ:

```text
Redis Host
Redis Port
Redis Username
Redis Password
Redis Database
TLS
Channel / Stream
```

Nếu kiến trúc thực tế chỉ cần:

```text
Host
Port
Access Token
```

thì chỉ hiển thị các trường cần thiết.

Không được bắt người dùng nhập thông tin không cần thiết.

---

# 13. Redis Event Source

Không được giả định Redis sử dụng một cơ chế duy nhất.

Có thể là:

```text
Redis Pub/Sub
Redis Streams
Queue
Application-specific channel
```

Event Listener phải có abstraction:

```python
class EventSource:

    connect()

    disconnect()

    subscribe()

    unsubscribe()

    receive()

    acknowledge()

    health_check()
```

Redis Adapter triển khai abstraction này.

---

# 14. Redis Pub/Sub

Nếu hệ thống sử dụng Redis Pub/Sub:

```text
SUBSCRIBE channel
```

Event Listener phải:

```text
Connect
 ↓
Authenticate
 ↓
SUBSCRIBE
 ↓
Receive Message
 ↓
Parse Event
 ↓
Normalize Event
 ↓
Display
```

Lưu ý:

Redis Pub/Sub thường không phải cơ chế lưu trữ event lâu dài.

Nếu Client mất kết nối, có khả năng mất message.

Do đó không được tuyên bố:

```text
Redis Pub/Sub = guaranteed event delivery
```

---

# 15. Redis Streams

Nếu hệ thống sử dụng Redis Streams:

ưu tiên:

```text
Consumer Group
Consumer ID
Message ID
Acknowledgement
```

Mục tiêu:

```text
Event
 ↓
Redis Stream
 ↓
Consumer
 ↓
IDE
```

Có thể hỗ trợ:

```text
Resume from last Event ID
```

Nếu hệ thống BRAVO thực tế sử dụng Streams.

---

# 16. Method 3 — Direct PostgreSQL

Nếu máy tính chạy IDE có thể truy cập trực tiếp PostgreSQL qua network:

```text
IDE
 │
 ▼
PostgreSQL
```

Không cần BRAVO Backend.

UI:

```text
PostgreSQL Connection

Host
[ 10.10.10.101 ]

Port
[ 5432 ]

Database
[ BravoDB ]

Username
[ ****** ]

Password
[ ****** ]

SSL Mode
[ ... ]

[ Test Connection ]
```

---

# 17. PostgreSQL Direct Listener

Không được chỉ sử dụng một cơ chế duy nhất cho mọi loại database event.

Cần phân biệt:

```text
LISTEN / NOTIFY
```

và:

```text
Logical Replication / Logical Decoding
```

và:

```text
Trigger → NOTIFY
```

---

# 18. LISTEN / NOTIFY

Nếu BRAVO hoặc database đã có cơ chế:

```sql
NOTIFY channel, payload;
```

Event Listener có thể:

```sql
LISTEN bravo_event;
```

Sau đó chờ notification.

Workflow:

```text
PostgreSQL
     ↓
NOTIFY
     ↓
LISTEN connection
     ↓
Event Listener
     ↓
Normalize Event
     ↓
UI
```

---

# 19. Không được coi LISTEN / NOTIFY là CDC

`LISTEN / NOTIFY` không mặc định cung cấp đầy đủ lịch sử thay đổi Row.

Do đó:

```text
LISTEN / NOTIFY
```

chỉ nên dùng khi hệ thống đã có cơ chế phát notification phù hợp.

Không được tự tuyên bố:

```text
LISTEN = theo dõi toàn bộ INSERT/UPDATE/DELETE
```

nếu database chưa có Trigger/Application logic tạo `NOTIFY`.

---

# 20. Trigger + NOTIFY

Nếu cần theo dõi thay đổi Row và hệ thống cho phép thay đổi schema/database, có thể sử dụng:

```text
INSERT
UPDATE
DELETE
     ↓
Trigger
     ↓
pg_notify()
     ↓
LISTEN
     ↓
Event Listener
```

Ví dụ concept:

```sql
CREATE TRIGGER ...
AFTER INSERT OR UPDATE OR DELETE
ON table_name
FOR EACH ROW
EXECUTE FUNCTION notify_change();
```

Trigger phải được thiết kế cẩn thận để không gây:

- Performance degradation.
- Payload quá lớn.
- Transaction overhead.
- Event duplication.

Không được tự động tạo Trigger vào database production nếu chưa có explicit user approval.

---

# 21. Logical Replication / Logical Decoding

Nếu yêu cầu là:

```text
Theo dõi thay đổi INSERT / UPDATE / DELETE
một cách đáng tin cậy hơn
```

cần xem xét:

```text
Logical Replication
Logical Decoding
Replication Slot
CDC mechanism
```

Đây là cơ chế khác hoàn toàn với:

```text
LISTEN / NOTIFY
```

Logical decoding có thể cung cấp thông tin thay đổi từ WAL tùy plugin/configuration.

---

# 22. Không tự động tạo Replication Slot

Replication Slot có thể giữ WAL và nếu consumer không xử lý có thể làm tăng dung lượng WAL.

Do đó:

```text
Create Replication Slot
```

phải là hành động explicit.

UI phải cảnh báo:

```text
Creating a logical replication slot can retain WAL
until the consumer advances the slot.

Make sure the listener is properly managed.
```

---

# 23. Event Source Priority

Không được tự động lựa chọn event source chỉ vì một connection có thể thực hiện được.

Nên có configuration:

```text
Event Source:

○ BRAVO Backend
○ Redis
○ PostgreSQL LISTEN/NOTIFY
○ PostgreSQL Logical Decoding
```

Mỗi source phải mô tả:

```text
Reliability
Persistence
Latency
Required Permission
Network Requirement
```

---

# 24. Event Listener Session

Mỗi Listener phải có session riêng.

Ví dụ:

```text
Listener #1
PostgreSQL
BravoDB
public

Listener #2
Redis
BravoBackend
Channel X
```

Không được dùng chung connection state không kiểm soát.

---

# 25. Connection Lifecycle

Listener phải hỗ trợ:

```text
CONNECTING
CONNECTED
LISTENING
DISCONNECTED
RECONNECTING
ERROR
STOPPED
```

UI:

```text
● Connected
```

hoặc:

```text
● Listening
```

Nếu mất kết nối:

```text
⚠ Connection lost

Retrying...
```

---

# 26. Auto Reconnect

Phải hỗ trợ reconnect.

Ví dụ:

```text
Connection lost
      ↓
Wait
      ↓
Retry
      ↓
Reconnect
      ↓
Re-subscribe
      ↓
Continue
```

Không reconnect vô hạn với interval cố định.

Ưu tiên exponential backoff:

```text
1s
2s
4s
8s
16s
...
```

có giới hạn tối đa.

---

# 27. Event Loss

Đây là vấn đề bắt buộc phải thể hiện rõ.

Mỗi Event Source phải khai báo:

```text
Can Resume?
Can Replay?
Persistent?
At-most-once?
At-least-once?
```

Ví dụ:

```text
Redis Pub/Sub
    → Có khả năng mất event khi disconnect.

Redis Streams
    → Có thể replay tùy retention/consumer configuration.

LISTEN/NOTIFY
    → Không phải event history.

Logical Decoding
    → Có thể replay theo replication slot tùy cấu hình.
```

Không được cam kết "không mất event" nếu nguồn không hỗ trợ.

---

# 28. Duplicate Event

Một event có thể xuất hiện nhiều lần.

Listener nên có:

```text
event_id
source
timestamp
transaction_id
```

Nếu source cung cấp ID ổn định, sử dụng để deduplicate.

Không được deduplicate chỉ bằng:

```text
timestamp
```

---

# 29. Event Ordering

Phải phân biệt:

```text
Network arrival order
```

và:

```text
Database transaction order
```

Không được giả định hai thứ giống nhau.

Nếu source cung cấp:

```text
LSN
Transaction ID
Sequence
Redis Stream ID
```

phải giữ metadata đó.

---

# 30. Event Filter

UI phải cho phép filter:

```text
Database
Schema
Table
Operation
Event Source
Event Type
Time
Transaction ID
```

Ví dụ:

```text
Table = B20Customer
Operation = UPDATE
```

---

# 31. Event Search

Event Log phải hỗ trợ:

```text
Ctrl + F
```

Search:

```text
Table
Column
Event ID
Transaction ID
Payload
Backend
Redis Channel
```

---

# 32. Event Detail

Click Event:

```text
┌───────────────────────────────────────────┐
│ Event Detail                              │
├───────────────────────────────────────────┤
│ Event ID       : ...                      │
│ Source         : PostgreSQL               │
│ Database       : BravoDB                  │
│ Schema         : public                   │
│ Table          : B20Customer              │
│ Operation      : UPDATE                   │
│ Timestamp      : ...                      │
│ Transaction ID : ...                      │
│ LSN            : ...                      │
│                                              
│ Payload                                      │
│ { ... }                                      │
└───────────────────────────────────────────┘
```

Chỉ hiển thị metadata nếu source thực sự cung cấp.

---

# 33. Event Payload

Payload có thể:

```text
JSON
Text
Binary
Database Record
Backend Message
Redis Message
```

Event Parser phải có khả năng normalize:

```text
Raw Event
    ↓
Parser
    ↓
Normalized Event
```

Nếu không parse được:

```text
UNKNOWN_EVENT
```

Không được tự ý suy đoán payload.

---

# 34. Backend Adapter

Backend Adapter phải độc lập với PostgreSQL Adapter.

```python
class BravoBackendAdapter:

    connect()

    authenticate()

    get_metadata()

    get_event_capabilities()

    subscribe_events()

    unsubscribe_events()

    receive_event()

    disconnect()
```

---

# 35. Redis Adapter

```python
class RedisEventAdapter:

    connect()

    authenticate()

    subscribe()

    receive()

    acknowledge()

    get_last_event_id()

    disconnect()
```

Các method không được triển khai giả nếu Redis source không hỗ trợ.

---

# 36. PostgreSQL Adapter

```python
class PostgreSQLEventAdapter:

    connect()

    get_database_metadata()

    listen()

    notify()

    start_logical_stream()

    stop_logical_stream()

    get_event()

    disconnect()
```

`listen()` và `start_logical_stream()` phải được coi là hai cơ chế khác nhau.

---

# 37. Unified Event Listener

Tất cả adapter phải đưa về:

```python
class DatabaseEvent:

    event_id
    source
    event_type
    database
    schema
    table
    operation
    timestamp
    transaction_id
    sequence
    payload
    metadata
```

UI chỉ nhận:

```text
DatabaseEvent
```

không cần biết event đến từ:

```text
Backend
Redis
PostgreSQL
```

---

# 38. Connection Configuration

Configuration nên có:

```json
{
    "name": "Bravo Production",
    "connection_type": "remote_backend",
    "backend": {
        "host": "...",
        "port": 8001,
        "auth": {
            "type": "access_token"
        }
    },
    "event_source": {
        "type": "backend"
    }
}
```

Với PostgreSQL:

```json
{
    "connection_type": "postgresql",
    "postgresql": {
        "host": "...",
        "port": 5432,
        "database": "...",
        "username": "...",
        "ssl_mode": "..."
    },
    "event_source": {
        "type": "listen_notify"
    }
}
```

---

# 39. Credential Storage

Access Token, Redis Password và PostgreSQL Password phải được coi là Secret.

Không lưu:

```text
Plain text trong source code
Plain text trong log
Plain text trong event payload
```

Nếu IDE có Credential Manager/Secure Storage thì sử dụng.

Configuration chỉ nên lưu reference:

```text
credential_id
```

thay vì password/token thực tế nếu kiến trúc cho phép.

---

# 40. Network Validation

Trước khi kết nối phải kiểm tra:

```text
DNS / Host
Port
TLS nếu có
Authentication
Authorization
Event Capability
```

Không được chỉ kiểm tra:

```text
Port open
```

rồi coi connection thành công.

---

# 41. Security Boundary

Không được bypass BRAVO Backend nếu kiến trúc BRAVO yêu cầu mọi truy cập phải thông qua Backend.

Method Direct PostgreSQL chỉ được sử dụng khi:

```text
User có quyền truy cập PostgreSQL
+
Mạng cho phép
+
Database cho phép
+
Cơ chế Event được cấu hình
```

Không được dùng Direct PostgreSQL để vượt qua authorization của Backend.

---

# 42. Connection Method 3 — Cùng mạng PostgreSQL

Nếu máy client nằm cùng network với PostgreSQL:

```text
Client
   │
   ├── TCP 5432
   │
   ▼
PostgreSQL
```

phải cho phép Direct PostgreSQL.

Tuy nhiên cần kiểm tra:

```text
PostgreSQL listen_addresses
pg_hba.conf
Firewall
Network routing
SSL
User permission
Database permission
```

---

# 43. UI Connection Wizard

Nên xây dựng Wizard:

```text
Step 1
Connection Method

    ○ Local BRAVO Backend
    ○ Remote BRAVO Backend
    ○ Direct PostgreSQL

        ↓

Step 2
Connection Information

        ↓

Step 3
Event Source

        ↓

Step 4
Test Connection

        ↓

Step 5
Start Listener
```

---

# 44. Local Backend Wizard

```text
Method:
Local BRAVO Backend

Available Backends:
[ Backend A ▼ ]

Status:
✓ Running

Event Source:
[ Backend Event ▼ ]

[ Test ]
[ Connect ]
```

---

# 45. Remote Backend Wizard

```text
Method:
Remote BRAVO Backend

Host:
[ ]

Port:
[ ]

Access Token:
[ ******** ]

Event Source:
[ Backend ]

[ Test Connection ]
```

---

# 46. Two Backend Wizard

```text
Method:
Remote BRAVO Backend

Backend 1
Host:
[ ]

Port:
[ ]

Access Token:
[ ******** ]

        ↓

Backend 2 / Redis

Redis Host:
[ ]

Redis Port:
[ ]

Authentication:
[ ]

Channel / Stream:
[ ]

[ Test Connection ]
```

Chỉ hiển thị Backend 2 nếu hệ thống thực tế yêu cầu.

---

# 47. PostgreSQL Wizard

```text
Method:
Direct PostgreSQL

Host:
[ ]

Port:
[5432]

Database:
[ ]

Username:
[ ]

Password:
[ ******** ]

SSL:
[ ]

Event Source:

○ LISTEN / NOTIFY
○ Logical Decoding

[ Test Connection ]
```

---

# 48. Permission Check

Sau khi PostgreSQL connection thành công phải kiểm tra quyền cần thiết cho Event Source.

Ví dụ:

```text
LISTEN/NOTIFY
    → Database connection permission

Logical Decoding
    → Các quyền/configuration đặc thù

Replication Slot
    → Quyền tương ứng
```

Không được chỉ kiểm tra quyền `SELECT`.

---

# 49. Listener Status

Taskbar hoặc Event Listener Panel phải hiển thị:

```text
● Connected
● Listening
● Reconnecting
● Error
● Stopped
```

Ví dụ:

```text
BRAVO Production
PostgreSQL
public.B20Customer

● Listening
Events: 1,284
Last Event: 01:32:10
```

---

# 50. Listener Log

Có thể có log:

```text
01:30:01 CONNECT
01:30:02 AUTHENTICATED
01:30:03 LISTENING
01:31:11 EVENT RECEIVED
01:32:04 EVENT RECEIVED
01:33:10 CONNECTION LOST
01:33:11 RECONNECTING
01:33:13 RECONNECTED
```

Không log:

```text
Access Token
Password
Redis Password
```

---

# 51. Stop Listener

Người dùng phải có:

```text
[Stop Listening]
```

Khi Stop:

```text
Unsubscribe
     ↓
Close Event Source
     ↓
Close Connection
     ↓
Update UI
```

Không giữ connection ngầm nếu listener đã Stop.

---

# 52. Multiple Listeners

IDE có thể hỗ trợ nhiều Listener:

```text
Listeners

├── Bravo Production
│   └── PostgreSQL
│
├── Bravo UAT
│   └── Redis
│
└── Bravo Development
    └── Backend
```

Mỗi Listener phải có session độc lập.

Không được trộn event giữa các connection.

---

# 53. Event Routing

Event phải giữ:

```text
listener_id
connection_id
source
```

để đảm bảo:

```text
Bravo Production event
```

không xuất hiện nhầm trong:

```text
Bravo UAT
```

---

# 54. Event Buffer

Nếu UI không xử lý kịp tốc độ event:

```text
Event Source
      ↓
Buffer
      ↓
Event Processor
      ↓
UI
```

Không được block network connection chỉ vì UI đang render.

Có thể sử dụng:

```text
asyncio
Queue
Worker
Background Task
```

tùy kiến trúc Python.

---

# 55. Backpressure

Nếu event rate cao:

```text
100 events/sec
1000 events/sec
10000 events/sec
```

phải có cơ chế:

```text
Queue limit
Batch processing
UI throttling
Event aggregation
Drop policy nếu user explicit cho phép
```

Không được để memory tăng vô hạn.

---

# 56. UI Rendering

Event Listener không được render từng event trực tiếp nếu tốc độ event rất cao.

Có thể:

```text
Receive:
1000 events/sec

UI:
Batch render
100 events / batch
```

Mục tiêu:

```text
Network processing
≠
UI rendering
```

---

# 57. Event Retention

Không giữ event vô hạn trong RAM.

Phải có:

```text
Maximum Events
Maximum Memory
Retention Time
```

Ví dụ:

```text
Maximum in-memory events:
10,000
```

Có thể hỗ trợ Export:

```text
Export JSON
Export CSV
Save Event Log
```

---

# 58. Event Filter trước UI

Nếu người dùng chỉ quan tâm:

```text
B20Customer
```

không cần đưa toàn bộ event vào UI.

Có thể filter:

```text
Source
Database
Schema
Table
Operation
```

ở Event Processor.

Tuy nhiên nếu filter ở client thì phải đảm bảo không ảnh hưởng đến cơ chế acknowledge/replay của source.

---

# 59. Không sửa Database từ Event Listener

Event Listener chỉ có trách nhiệm:

```text
Listen
Receive
Normalize
Display
Store
```

Không tự động:

```text
UPDATE
DELETE
INSERT
```

database khi nhận event.

Nếu cần action dựa trên event, phải là một chức năng riêng.

---

# 60. Error Handling

Các lỗi phải được phân loại:

```text
CONNECTION_ERROR
AUTHENTICATION_ERROR
AUTHORIZATION_ERROR
TIMEOUT_ERROR
SUBSCRIPTION_ERROR
PARSER_ERROR
EVENT_SOURCE_ERROR
REDIS_ERROR
POSTGRES_ERROR
BACKEND_ERROR
CONCURRENCY_ERROR
UNKNOWN_ERROR
```

UI phải hiển thị nguyên nhân dễ hiểu.

---

# 61. Parser Error

Nếu nhận được event nhưng không parse được:

```text
⚠ Unknown event format

Source:
Redis

Channel:
bravo_event

Message:
[Raw message available]
```

Không được crash Listener.

Event Parser phải fail gracefully.

---

# 62. Health Check

Listener phải có health state:

```text
Backend:
✓

Redis:
✓

PostgreSQL:
✓

Event Source:
✓

Last Event:
01:32:10
```

Nếu không có event trong thời gian dài, không được tự động kết luận connection chết.

Phải phân biệt:

```text
Connected but no event
```

và:

```text
Disconnected
```

---

# 63. Test Event

Có thể cung cấp:

```text
[Send Test Event]
```

nhưng chỉ dành cho source cho phép test.

Không được tự ý INSERT/UPDATE production data chỉ để test listener.

---

# 64. PostgreSQL Event Testing

Đối với `LISTEN/NOTIFY`, có thể test bằng notification riêng:

```sql
NOTIFY test_channel, 'test';
```

Không sử dụng business table để tạo test event nếu không cần thiết.

---

# 65. Logging

Log phải gồm:

```text
Timestamp
Listener ID
Connection ID
Source
Event Type
Table
Operation
Latency
Error
```

Không log:

```text
Password
Access Token
Redis Password
Sensitive Payload
```

trừ khi người dùng explicit bật debug mode và hệ thống có cơ chế masking.

---

# 66. Latency

Event có thể hiển thị:

```text
Event Timestamp
Received Timestamp
Processing Timestamp
UI Timestamp
```

Từ đó tính:

```text
Network Latency
Processing Latency
UI Latency
Total Latency
```

Nếu source không cung cấp event timestamp thì chỉ sử dụng received timestamp.

---

# 67. Event Source Capability

Mỗi Adapter phải khai báo capability.

Ví dụ:

```json
{
    "source": "redis_pubsub",
    "persistent": false,
    "replay": false,
    "acknowledgement": false,
    "ordering": "channel_order"
}
```

PostgreSQL LISTEN:

```json
{
    "source": "postgres_listen_notify",
    "persistent": false,
    "replay": false,
    "acknowledgement": false
}
```

Logical decoding tùy cấu hình:

```json
{
    "source": "postgres_logical_decoding",
    "persistent": true,
    "replay": true
}
```

Không được hard-code những capability này nếu adapter thực tế có hành vi khác.

---

# 68. Không đồng nhất hóa quá mức

Mặc dù UI sử dụng `DatabaseEvent` chung, phải giữ lại:

```text
source_metadata
```

Ví dụ:

```json
{
    "event_id": "...",
    "source": "redis",
    "metadata": {
        "channel": "bravo.customer",
        "redis_stream_id": "..."
    }
}
```

hoặc:

```json
{
    "source": "postgresql",
    "metadata": {
        "lsn": "...",
        "transaction_id": 123
    }
}
```

Không được làm mất metadata đặc thù của source.

---

# 69. Security Rules

Bắt buộc:

1. Không lưu Access Token plain text nếu có Secure Storage.
2. Không log Access Token.
3. Không log password.
4. Không hiển thị credential trong Event Detail.
5. Không truyền credential qua Event Payload.
6. Không bypass Backend Authorization.
7. Không tự động tạo PostgreSQL replication slot.
8. Không tự động tạo Trigger trên Production.
9. Không tự động thay đổi PostgreSQL configuration.
10. Không tự động sửa database chỉ để kiểm tra Listener.

---

# 70. Connection Profiles

Cho phép lưu:

```text
Bravo Production
Bravo UAT
Bravo Development
```

Nhưng profile chỉ lưu:

```text
Host
Port
Database
Connection Type
Event Source
Credential Reference
```

Không lưu secret trực tiếp nếu Secure Credential Storage có sẵn.

---

# 71. Connection Profile Example

```json
{
    "name": "Bravo Production",
    "type": "remote_backend",

    "backend": {
        "host": "10.10.10.100",
        "port": 8001,
        "credential_ref": "credential-bravo-prod"
    },

    "event_source": {
        "type": "backend"
    }
}
```

Redis:

```json
{
    "name": "Bravo Production Redis",

    "type": "remote_backend",

    "backend": {
        "host": "10.10.10.100",
        "port": 8001,
        "credential_ref": "credential-bravo-prod"
    },

    "redis": {
        "host": "10.10.10.101",
        "port": 6379,
        "credential_ref": "credential-redis-prod",
        "channel": "bravo_event"
    },

    "event_source": {
        "type": "redis"
    }
}
```

PostgreSQL:

```json
{
    "name": "Bravo PostgreSQL",

    "type": "postgresql",

    "postgresql": {
        "host": "10.10.10.102",
        "port": 5432,
        "database": "BravoDB",
        "credential_ref": "credential-postgres"
    },

    "event_source": {
        "type": "listen_notify"
    }
}
```

---

# 72. Connection Flow

## Local Backend

```text
Detect Backend
      ↓
Select Backend
      ↓
Connect
      ↓
Authenticate
      ↓
Check Event Capability
      ↓
Start Listener
```

## Remote Backend

```text
Host + Port + Token
      ↓
Connect
      ↓
Authenticate
      ↓
Check Capability
      ↓
Start Listener
```

## Two Backend + Redis

```text
Backend 1
    ↓
Backend 2 / Redis
    ↓
Subscribe
    ↓
Receive
    ↓
Normalize
    ↓
Event UI
```

## Direct PostgreSQL

```text
Host + Port + DB + User
      ↓
Connect PostgreSQL
      ↓
Check Permission
      ↓
Select Event Source
      ↓
LISTEN / Logical Decoding
      ↓
Event UI
```

---

# 73. Những điều không được giả định

Không được giả định:

```text
BRAVO Backend nào cũng có Event API.
```

Không được giả định:

```text
Redis nào cũng dùng Pub/Sub.
```

Không được giả định:

```text
Redis event = PostgreSQL event.
```

Không được giả định:

```text
LISTEN/NOTIFY theo dõi mọi INSERT/UPDATE/DELETE.
```

Không được giả định:

```text
Có thể truy cập PostgreSQL thì có quyền Logical Decoding.
```

Không được giả định:

```text
Một Backend duy nhất trong mọi môi trường BRAVO.
```

Không được giả định:

```text
Event luôn có Row data.
```

Không được giả định:

```text
Event luôn có User ID.
```

Không được giả định:

```text
Event luôn có thứ tự tuyệt đối.
```

---

# 74. Nguyên tắc triển khai

Ưu tiên triển khai theo thứ tự:

```text
Phase 1
Unified Event Model
+
Event Listener Core
+
Connection Manager

        ↓

Phase 2
Local BRAVO Backend
+
Remote BRAVO Backend

        ↓

Phase 3
Redis Adapter

        ↓

Phase 4
Direct PostgreSQL
LISTEN / NOTIFY

        ↓

Phase 5
Logical Decoding nếu môi trường BRAVO
yêu cầu và có quyền phù hợp
```

---

# 75. Acceptance Criteria

Chức năng được coi là đạt khi:

## Connection

```text
[x] Local Backend
[x] Remote Backend
[x] Backend IP
[x] Backend Port
[x] Access Token
[x] Two Backend configuration
[x] Redis configuration
[x] Direct PostgreSQL
```

## Listener

```text
[x] Connect
[x] Disconnect
[x] Reconnect
[x] Subscribe
[x] Receive
[x] Normalize Event
[x] Filter
[x] Search
[x] Event Detail
```

## Reliability

```text
[x] Connection state
[x] Error handling
[x] Reconnect
[x] Event source capability
[x] Duplicate handling
[x] Event ordering metadata
[x] Buffer limit
```

## Security

```text
[x] Token masking
[x] Password masking
[x] Secure credential reference
[x] No credential logging
[x] No unauthorized PostgreSQL access
```

---

# 76. Nguyên tắc cuối cùng

Chức năng này phải được xây dựng theo mô hình:

```text
                    ┌───────────────────┐
                    │    Event UI       │
                    └─────────┬─────────┘
                              │
                              ▼
                    ┌───────────────────┐
                    │ Event Listener    │
                    │ Core              │
                    └─────────┬─────────┘
                              │
                       Unified Event
                              │
             ┌────────────────┼────────────────┐
             │                │                │
             ▼                ▼                ▼
       BRAVO Backend       Redis         PostgreSQL
             │                │                │
             ▼                ▼                ▼
        Backend API       Pub/Sub/       LISTEN/
                          Streams         Logical
                                          Decoding
```

Mục tiêu của kiến trúc là:

```text
Một Event Model
+
Nhiều Event Source
+
Nhiều Connection Method
+
Một Listener Core
+
Một UI
```

Không được xây dựng ba chức năng kết nối thành ba hệ thống độc lập.

Đặc biệt, phải phân biệt rõ:

```text
BRAVO Backend Event
≠
Redis Event
≠
PostgreSQL LISTEN/NOTIFY
≠
PostgreSQL Logical Decoding
```

Mỗi nguồn có độ tin cậy, khả năng replay, ordering, permission và cơ chế mất event khác nhau. UI có thể thống nhất cách hiển thị, nhưng tầng Adapter bắt buộc phải giữ đúng đặc tính của từng nguồn.